// Tên gợi nhớ (Zalo alias) — logic THUẦN dựng chuỗi alias từ template đã render.
// Tách riêng (pure, không DB/SDK) để unit-test được — module automation chưa có harness
// worker (BullMQ+Redis+Prisma+Zalo mock), nên phần kiểm thử nằm ở đây. 2026-06-19.

// Giới hạn độ dài alias Zalo: zca-js KHÔNG enforce; Zalo server có trần (chưa rõ chính xác).
// Đặt thận trọng 60; verify thực tế lúc QA — nếu Zalo từ chối thì hạ. Mẫu CEO đặt SĐT cuối
// nên khi quá dài, phần bị cắt là đuôi (SĐT) — phần tên/dự án (đầu) được giữ.
export const DEFAULT_ALIAS_MAX = 60;

/**
 * Dựng alias cuối cùng từ chuỗi đã renderTemplate:
 *  - gộp khoảng trắng thừa (do biến RỖNG để lại "  ") thành 1 space + trim.
 *  - rỗng → '' (caller skip, không gọi SDK).
 *  - quá maxLen → cắt an toàn, ưu tiên theo ranh giới từ (không để space/đứt từ giữa chừng),
 *    chỉ cắt-theo-từ nếu không mất quá nhiều (>60% maxLen), else hard-cut.
 */
export function buildAlias(raw: string, maxLen: number = DEFAULT_ALIAS_MAX): string {
  const collapsed = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  if (collapsed.length <= maxLen) return collapsed;
  const cut = collapsed.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  const safe = lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut;
  return safe.trim();
}
