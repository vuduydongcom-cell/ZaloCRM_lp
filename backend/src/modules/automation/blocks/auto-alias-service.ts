// Tự đặt tên gợi nhớ (Zalo alias) cho KH trong trigger. 2026-06-19 (Anh chốt).
//
// ĐÍNH CHÍNH premise: zca-js changeFriendAlias(alias, friendId=UID) POST /api/alias/update
// KHÔNG kiểm friendship → chỉ cần UID (từ findUser theo SĐT) là đặt được, KHÔNG cần khách
// đồng ý kết bạn. Nên gọi NGAY trong request_friend khi vừa có UID → "đặt hết trong trigger".
//
// LUÔN ĐÈ theo mẫu (set-semantics, idempotent → chạy lại vô hại, không cần dedup marker).
// Lõi dùng chung: auto (request_friend) bây giờ; step set_alias kéo-thả (v1.1) tái dùng y nguyên.

import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { zaloOps } from '../../../shared/zalo-operations.js';
import { renderTemplate } from './render-template.js';
import { buildAlias } from './alias-template.js';
import { logEvent } from '../friend-invite/event-log-service.js';
import { logActivity } from '../../activity/activity-logger.js';

export interface SetContactAliasArgs {
  orgId: string;
  contactId: string;
  nickId: string;          // ZaloAccount.id (nick đặt tên)
  template: string;        // mẫu alias (biến render-template)
  triggerProject?: string; // → biến {trigger_project}
  uid?: string;            // UID live từ findUser (nếu có → khỏi query Friend)
  zaloName?: string;       // tên Zalo live từ findUser → override {zalo_name}
  phone?: string;          // SĐT đã biết của tệp (entry) → override {phone} (Contact.phone có thể trống ở stub)
  triggerId?: string;      // để logEvent (logEvent cần triggerId; thiếu → bỏ log)
  // Actor cho Timeline Hoạt động (Anh chốt 2026-06-19): user (sale Lead Pool) hoặc system (trigger auto).
  actorUserId?: string;        // sale thao tác (Lead Pool) → actorType=user
  actorSystemSource?: string;  // nguồn hệ thống (vd 'auto_alias_trigger') → actorType=system
}

export type SetContactAliasResult =
  | { ok: true; alias: string; changed: boolean }
  | { ok: false; skipped: 'no_uid' | 'empty' | 'no_template' | 'unchanged' }
  | { ok: false; failed: 'rate_limited' | 'sdk_error'; retryable: boolean };

/**
 * Render mẫu → dựng alias → changeFriendAlias. Không throw (trả result).
 * Luôn load Friend(contactId, nickId) để: (a) lấy UID fallback nếu caller không truyền,
 * (b) lấy alias CŨ (aliasInNick) → log "đặt mới" vs "cũ → mới", (c) ghi aliasInNick mới về CRM.
 * Trùng alias cũ = mới → BỎ QUA (không gọi SDK, không log, tiết kiệm quota).
 */
export async function setContactAlias(args: SetContactAliasArgs): Promise<SetContactAliasResult> {
  const { orgId, contactId, nickId, template, triggerProject, zaloName, triggerId } = args;
  if (!template || !template.trim()) return { ok: false, skipped: 'no_template' };

  // 1. Load TẤT CẢ Friend row của (contact × nick) — KH có thể có NHIỀU UID/danh tính Zalo
  //    trên cùng 1 nick (vd accepted + pending khác UID). Đặt alias cho HẾT để chat (dùng UID
  //    nào cũng) thấy + alias-sync không xoá nhầm (Anh báo bug 2026-06-19).
  const friends = await prisma.friend.findMany({
    where: { contactId, zaloAccountId: nickId },
    select: { id: true, zaloUidInNick: true, aliasInNick: true },
  });
  const byUid = new Map<string, { ids: string[]; oldAlias: string }>();
  for (const f of friends) {
    const u = (f.zaloUidInNick ?? '').trim();
    if (!u) continue;
    const t = byUid.get(u) ?? { ids: [], oldAlias: '' };
    t.ids.push(f.id);
    if (!t.oldAlias && f.aliasInNick) t.oldAlias = f.aliasInNick.trim();
    byUid.set(u, t);
  }
  const passedUid = (args.uid ?? '').trim();
  if (passedUid && !byUid.has(passedUid)) byUid.set(passedUid, { ids: [], oldAlias: '' });
  if (byUid.size === 0) return { ok: false, skipped: 'no_uid' };

  // 2. Render mẫu 1 lần (extraVars: {trigger_project} + override {zalo_name}/{phone} live)
  const extraVars: Record<string, string> = { trigger_project: (triggerProject ?? '').trim() };
  if (zaloName && zaloName.trim()) extraVars.zalo_name = zaloName.trim();
  if (args.phone && args.phone.trim()) extraVars.phone = args.phone.trim();
  const raw = await renderTemplate(template, contactId, nickId, extraVars);
  const newAlias = buildAlias(raw);
  if (!newAlias) return { ok: false, skipped: 'empty' };

  let representativeOld = '';
  for (const t of byUid.values()) { if (t.oldAlias) { representativeOld = t.oldAlias; break; } }

  // 3. Đặt alias cho TỪNG UID (trùng tên cũ → bỏ qua, đỡ quota)
  let anySet = false, anyChanged = false;
  let lastFail: 'rate_limited' | 'sdk_error' | null = null, lastRetryable = false;
  for (const [u, t] of byUid) {
    if (t.oldAlias && t.oldAlias === newAlias) { anySet = true; continue; }
    try {
      await zaloOps.changeFriendAlias(nickId, newAlias, u);
    } catch (err: any) {
      if ((err?.code as string) === 'RATE_LIMITED') { lastFail = 'rate_limited'; lastRetryable = true; }
      else { lastFail = 'sdk_error'; lastRetryable = false; logger.warn(`[auto-alias] changeFriendAlias failed nick=${nickId} uid=${u}:`, err); }
      continue;
    }
    anySet = true; anyChanged = true;
    if (t.ids.length) {
      await prisma.friend.updateMany({ where: { id: { in: t.ids } }, data: { aliasInNick: newAlias } })
        .catch((err) => logger.warn(`[auto-alias] update aliasInNick failed:`, err));
    }
  }
  if (!anySet) return lastFail ? { ok: false, failed: lastFail, retryable: lastRetryable } : { ok: false, skipped: 'no_uid' };
  if (!anyChanged) return { ok: false, skipped: 'unchanged' };

  // 4. Log 1 lần: automation event + Timeline Hoạt động (Anh chốt 2026-06-19)
  const summary = representativeOld
    ? `Đổi tên gợi nhớ: "${representativeOld}" → "${newAlias}"`
    : `Đặt tên gợi nhớ MỚI: "${newAlias}"`;
  if (triggerId) {
    void logEvent({ orgId, triggerId, contactId, nickId, eventType: 'contact_alias_set', eventPriority: 'info',
      summary, metadata: { oldAlias: representativeOld || null, newAlias } });
  }
  logActivity({
    orgId, action: 'friend_alias_change', entityType: 'contact', entityId: contactId,
    details: { old: representativeOld || null, new: newAlias, trigger: args.actorUserId ? 'crm_edit' : 'auto_trigger' },
    userId: args.actorUserId ?? null,
    systemSource: args.actorUserId ? null : (args.actorSystemSource ?? 'auto_alias'),
  });
  logger.info(`[auto-alias] set nick=${nickId} contact=${contactId} uids=${byUid.size} old="${representativeOld}" new="${newAlias}"`);
  return { ok: true, alias: newAlias, changed: anyChanged };
}
