// ════════════════════════════════════════════════════════════════════════
// schedule-calculator — Luật 1 (giờ) + Luật 2 (giãn cách) — PURE, không DB
// ════════════════════════════════════════════════════════════════════════
//
// Sequence recode Đợt 1 (2026-06-13). Codex #11: TÁCH calculator dùng CHUNG cho
// engine (worker tính delay bước kế) VÀ ETA (đợt 2 cộng dồn delay) → tránh tính 2
// kiểu rồi lệch nhau. File pure (không import prisma) để unit-test không cần DB.
//
// Hai phép tính:
//   1. sendGapMs(rules)      — luật 2: giãn cách bước kế ra milliseconds.
//   2. nextAllowedTime(from) — luật 1: dời 1 mốc vào trong khung giờ hoạt động.
//   3. etaCompleteAt(...)    — cộng dồn delay các bước CÒN LẠI + né ngoài giờ (ETA).

import type { SendGap, SequenceRuntimeRules, SequenceStep } from '../sequences/types.js';

const MS = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000 } as const;

/**
 * Quy sendGap ra milliseconds. RANDOM trong [min, max] (cùng đơn vị) — pick mỗi lần
 * gọi (anh chốt 2026-06-15: gửi xong step N → pick ngẫu nhiên → lưu trong job step N+1).
 * Legacy { value } → cố định. Giá trị ≤0 → 0 (gửi ngay).
 *
 * @param rand hàm random [0,1) — inject để test ổn định (default Math.random).
 */
export function sendGapToMs(gap: SendGap | undefined, rand: () => number = Math.random): number {
  if (!gap) return 0;
  const unitMs = MS[gap.unit];
  // Khoảng random [min, max].
  if (typeof gap.min === 'number' && typeof gap.max === 'number') {
    if (gap.max <= 0) return 0;
    const lo = Math.max(0, gap.min);
    const hi = Math.max(lo, gap.max);
    const picked = lo + rand() * (hi - lo); // đơn vị nguyên (vd 15..30 phút)
    return Math.round(picked * unitMs);
  }
  // Legacy cố định.
  if (typeof gap.value === 'number' && gap.value > 0) return Math.round(gap.value * unitMs);
  return 0;
}

/**
 * Delay bước kế (ms): ưu tiên rules.sendGap (luật 2, random [min,max]); fallback
 * step.delayMinutes (data cũ chưa set sendGap). Worker dùng để enqueue bước N+1.
 *
 * @param rand inject random để test (default Math.random).
 */
// 2026-06-19 (anh chốt: gộp Luật 2 vào step) — delay bước kế = delayMinutes CỐ ĐỊNH ± random
// trong [-jitter, +jitter] phút (chống Zalo nghi bot). jitter=0 → đúng delayMinutes. Không âm.
// Bỏ hẳn cơ chế sendGap toàn cục (trước đây ĐÈ delayMinutes — gây sơ đồ bước hiển thị sai).
export function stepDelayMs(
  delayMinutes: number,
  jitterMinutes = 0,
  rand: () => number = Math.random,
): number {
  const base = Math.max(0, (delayMinutes ?? 0) * MS.minute);
  const jit = Math.max(0, jitterMinutes ?? 0);
  if (jit <= 0) return base;
  const deltaMin = (rand() * 2 - 1) * jit; // [-jit, +jit) phút; rand=0.5 → 0 (điểm giữa cho preview/ETA)
  return Math.max(0, Math.round(base + deltaMin * MS.minute));
}

// "HH:mm" → phút-trong-ngày 0..1440. Cho phép "24:00"=1440 (chỉ hợp lệ cho end). Sai → null.
function parseHHmm(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 24 || min < 0 || min > 59 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

/**
 * Khung giờ hoạt động (luật 1) → phút-trong-ngày, nửa-mở [startMin, endMin) giờ VN.
 * ƯU TIÊN `allowedTimeRange` ("HH:mm", tới phút); fallback `allowedHourRange` (giờ
 * tròn ×60) cho config cũ. null = không giới hạn. NGUỒN SỰ THẬT DUY NHẤT cho mọi
 * check giờ (nextAllowedTime / isOutOfHours / welcome-probe / gate-evaluator).
 */
export function resolveWindowMinutes(
  rules: SequenceRuntimeRules | null | undefined,
): { startMin: number; endMin: number } | null {
  if (!rules) return null;
  const tr = rules.allowedTimeRange;
  if (Array.isArray(tr) && tr.length === 2) {
    const s = parseHHmm(tr[0]);
    const e = parseHHmm(tr[1]);
    if (s !== null && e !== null && s < e) return { startMin: s, endMin: e };
  }
  const hr = rules.allowedHourRange;
  if (Array.isArray(hr) && hr.length === 2) {
    const [s, e] = hr;
    if (typeof s === 'number' && typeof e === 'number' && s < e) {
      return { startMin: s * 60, endMin: e * 60 };
    }
  }
  return null;
}

// Phút-trong-ngày theo giờ VN (UTC+7) của `at`. 0..1440 (có phần lẻ giây/ms).
export function vnMinutesOfDay(at: Date): number {
  const shifted = at.getTime() + 7 * MS.hour;
  return (shifted - Math.floor(shifted / MS.day) * MS.day) / MS.minute;
}

/**
 * Dời `at` vào trong khung giờ hoạt động (luật 1) — CHUẨN TỚI PHÚT, nửa-mở
 * [start, end) theo giờ VN (UTC+7). Trong khung → giữ nguyên; ngoài khung → mốc
 * `start` của khung kế (hôm nay nếu chưa tới, mai nếu đã qua), canh đúng phút (giây=0).
 *
 * @param at    mốc cần kiểm (Date)
 * @param rules runtimeRules (đọc allowedTimeRange/allowedHourRange). null = không giới hạn.
 * @returns Date đã dời vào khung (hoặc nguyên `at` nếu không có khung / đã trong khung)
 */
export function nextAllowedTime(
  at: Date,
  rules: SequenceRuntimeRules | null | undefined,
): Date {
  const w = resolveWindowMinutes(rules);
  if (!w) return at;
  const { startMin, endMin } = w;
  if (startMin >= endMin) return at; // vô nghĩa → bỏ qua gate

  const shifted = at.getTime() + 7 * MS.hour;
  const dayStart = Math.floor(shifted / MS.day) * MS.day; // 00:00 VN (theo epoch đã shift)
  const cur = (shifted - dayStart) / MS.minute; // phút-trong-ngày VN
  if (cur >= startMin && cur < endMin) return at; // trong khung → giữ

  let target = dayStart + startMin * MS.minute;
  if (target <= shifted) target += MS.day; // đã qua khung hôm nay → đầu khung mai
  return new Date(target - 7 * MS.hour);
}

/**
 * ETA hoàn tất luồng (đợt 2 dùng để hiện "bao lâu nữa xong"): cộng dồn delay các bước
 * CÒN LẠI từ `fromStepIdx`+1 tới cuối, mỗi bước né ngoài giờ. KHÔNG scan queue.
 *
 * @param steps        toàn bộ steps của sequence
 * @param fromStepIdx  bước hiện tại (đã/đang gửi); cộng từ bước kế
 * @param fromTime     mốc bắt đầu cộng (thường nextRunAt của bước kế, hoặc now)
 * @param rules        runtimeRules (sendGap + allowedHourRange)
 * @returns Date dự kiến gửi xong bước cuối, hoặc null nếu đã ở bước cuối.
 */
export function etaCompleteAt(
  steps: SequenceStep[],
  fromStepIdx: number,
  fromTime: Date,
  rules: SequenceRuntimeRules | null | undefined,
): Date | null {
  if (fromStepIdx >= steps.length - 1) return null; // đã ở/qua bước cuối
  let t = fromTime;
  // ETA dùng ĐIỂM GIỮA của khoảng random (rand=0.5) → ổn định, không nhảy mỗi lần mở
  // panel. Thực tế mỗi step pick random riêng nên ETA là ước lượng (hiển thị "dự kiến").
  const midRand = () => 0.5;
  for (let i = fromStepIdx + 1; i < steps.length; i++) {
    const gapMs = stepDelayMs(steps[i].delayMinutes, steps[i].delayJitterMinutes ?? 0, midRand);
    t = new Date(t.getTime() + gapMs);
    t = nextAllowedTime(t, rules);
  }
  return t;
}
