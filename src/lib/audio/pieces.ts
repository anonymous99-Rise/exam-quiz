/**
 * 听力分段的纯函数
 *
 * 分段标签来自素材库/旧站，形如：
 *   'Section A · 第 1 篇 · 1–4 题'
 *   'Section C · 第 3 篇 · 22–25 题'
 * 解出题号范围后，点分段就能「跳到该篇音频 + 滚到对应题目」。
 */

/** 从分段标签里解出题号范围；解不出返回 null（不猜） */
export function parsePieceRange(label: string): [number, number] | null {
  // 连字符放在末尾才是字面量：放中间会被当成区间（– 是 U+2013，比 ~ 大）
  const range = label.match(/(\d+)\s*[–—~-]\s*(\d+)\s*题/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    return a <= b ? [a, b] : [b, a];
  }
  const single = label.match(/(\d+)\s*题/);
  if (single) {
    const n = Number(single[1]);
    return [n, n];
  }
  return null;
}

/** 秒 → mm:ss；非法值返回 00:00 */
export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 当前播放时间落在哪一段（返回下标；无匹配返回 -1） */
export function pieceIndexAt(
  pieces: { start: number; end: number }[],
  t: number,
): number {
  return pieces.findIndex((p) => t >= p.start && t < p.end);
}
