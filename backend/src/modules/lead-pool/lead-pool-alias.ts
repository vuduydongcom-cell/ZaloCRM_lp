// "Đặt tên gợi nhớ thông minh" — mặt Lead Pool (Anh chốt 2026-06-19).
// Sale nhận số → bấm nút trên LeadRequestModal → đặt tên gợi nhớ Zalo theo mẫu GỢI Ý.
// Tách file riêng (KHÔNG đụng lead-pool-service.ts = vùng WIP agent khác).
//
// Tái dùng lõi: setContactAlias (auto-alias-service) + renderTemplate + buildAlias.
// Mẫu mặc định CEO: Giới tính + Tên + SĐT + Ngày + Trạng thái.

import { prisma } from '../../shared/database/prisma-client.js';
import { renderTemplate } from '../automation/blocks/render-template.js';
import { buildAlias } from '../automation/blocks/alias-template.js';
import { setContactAlias } from '../automation/blocks/auto-alias-service.js';

export const RECOMMENDED_LEAD_ALIAS_TEMPLATE = '{gender} {name} {phone} {date} {status}';

export class LeadAliasError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

/**
 * Resolve nick của sale cho contact này: ưu tiên nickId truyền vào (phải thuộc sale),
 * nếu không → nick có Friend row với contact (đã findUser ra UID). Trả null nếu chưa có.
 */
async function resolveSaleNick(args: {
  orgId: string; userId: string; contactId: string; nickId?: string | null;
}): Promise<string | null> {
  const { orgId, userId, contactId, nickId } = args;
  if (nickId) {
    const own = await prisma.zaloAccount.findFirst({
      where: { id: nickId, ownerUserId: userId, orgId },
      select: { id: true },
    });
    if (own) return own.id;
  }
  // Friend row với 1 nick OWN của sale (đã có UID)
  const friend = await prisma.friend.findFirst({
    where: { contactId, orgId, zaloAccount: { ownerUserId: userId } },
    select: { zaloAccountId: true },
    orderBy: { updatedAt: 'desc' },
  });
  return friend?.zaloAccountId ?? null;
}

/** Kiểm contact đã được giao cho sale này (bảo mật) + trả SĐT (cho override {phone}). */
async function assertAssigned(orgId: string, userId: string, contactId: string): Promise<{ phone: string }> {
  const c = await prisma.contact.findFirst({
    where: { id: contactId, orgId },
    select: { assignedUserId: true, phone: true, phoneNormalized: true },
  });
  if (!c) throw new LeadAliasError(404, 'contact_not_found');
  if (c.assignedUserId !== userId) throw new LeadAliasError(403, 'contact_not_assigned_to_you');
  // {phone} ưu tiên Contact.phone; trống thì phoneNormalized (đề phòng contact stub).
  return { phone: (c.phone || c.phoneNormalized || '').trim() };
}

/**
 * PREVIEW: render mẫu thành alias (KHÔNG đặt lên Zalo). Cho sale xem/sửa trước khi đặt.
 */
export async function previewLeadAlias(args: {
  orgId: string; userId: string; contactId: string; nickId?: string | null; template?: string;
}): Promise<{ alias: string; nickId: string | null; hasUid: boolean }> {
  const { orgId, userId, contactId } = args;
  const { phone } = await assertAssigned(orgId, userId, contactId);
  const nickId = await resolveSaleNick(args);
  const template = (args.template?.trim()) || RECOMMENDED_LEAD_ALIAS_TEMPLATE;
  if (!nickId) return { alias: buildAlias(template.replace(/\{[^}]+\}/g, '')), nickId: null, hasUid: false };
  const friend = await prisma.friend.findFirst({
    where: { contactId, zaloAccountId: nickId }, select: { zaloUidInNick: true },
  });
  const extraVars = phone ? { phone } : undefined;
  const raw = await renderTemplate(template, contactId, nickId, extraVars);
  return { alias: buildAlias(raw), nickId, hasUid: !!friend?.zaloUidInNick };
}

/**
 * SET: đặt alias lên Zalo (qua setContactAlias — render + changeFriendAlias + log + lưu aliasInNick).
 */
export async function setLeadAlias(args: {
  orgId: string; userId: string; contactId: string; nickId?: string | null; template?: string;
}): Promise<{ ok: boolean; alias?: string; reason?: string }> {
  const { orgId, userId, contactId } = args;
  const { phone } = await assertAssigned(orgId, userId, contactId);
  const nickId = await resolveSaleNick(args);
  if (!nickId) throw new LeadAliasError(400, 'no_zalo_nick_for_contact'); // chưa tìm thấy Zalo qua nick sale
  const template = (args.template?.trim()) || RECOMMENDED_LEAD_ALIAS_TEMPLATE;
  const res = await setContactAlias({ orgId, contactId, nickId, template, phone: phone || undefined, actorUserId: userId });
  if (res.ok) return { ok: true, alias: res.alias };
  if ('skipped' in res) return { ok: false, reason: res.skipped };
  return { ok: false, reason: res.failed };
}
