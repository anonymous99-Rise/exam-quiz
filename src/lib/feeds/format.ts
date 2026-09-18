/**
 * 订阅源的纯格式化函数（**客户端也要用**）
 *
 * ⚠ 这个文件必须保持「零服务端依赖」：`listen-view` / `read-view` / `podcast-player`
 * 都是客户端组件，它们需要 `formatDuration` / `formatFeedDate` / `readingStats`。
 * 曾经把这些函数放在 api.ts 里，而 api.ts 为了「本地样本兜底」引入了 `node:fs` ——
 * 于是客户端图里混进 node 模块，Turbopack 直接报
 * `the chunking context does not support external modules (request: node:fs)` 构建失败。
 * 所以：**凡是要给客户端用的函数，都不许放在会 import fs 的模块里**。
 */

/** 秒 → `12:34` / `1:02:03` */
export function formatDuration(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return '--:--';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** ISO → `9月17日`（当年）/ `2025年3月31日`（跨年），列表扫读够用 */
export function formatFeedDate(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 文章体量：英文字数 + 中文字数，阅读时长按英文 200 wpm、中文 400 字/分估算 */
export function readingStats(text: string): { words: number; minutes: number } {
  const cn = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const en = (text.replace(/[\u4e00-\u9fff]/g, ' ').match(/[A-Za-z][A-Za-z'’-]*/g) ?? []).length;
  const minutes = Math.max(1, Math.round(en / 200 + cn / 400));
  return { words: en + cn, minutes };
}
