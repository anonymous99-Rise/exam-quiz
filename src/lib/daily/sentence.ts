/**
 * 每日推送（金山词霸「每日一句」）数据模型
 * ============================================================================
 * 上游：`api.timelessq.com/english-sentence`（2012 年至今约 5162 条）
 *
 * 三个接口共用一套数据模型，但**老数据与新数据的字段并不一致**（实测）：
 *
 *   | 字段 | 新版（2023+） | 老版（2012–2018） |
 *   | --- | --- | --- |
 *   | `sid` | 字符串 `"6081"` | 数字 `3210` |
 *   | `tts` | 音频 mp3 地址 | `null`（没有配音） |
 *   | `picture` 系列 | `staticedu-wps-cache.iciba.com` 的新图 | `cdn.iciba.com/news/word/…` 的老图 |
 *   | `translation` | 固定占位「新版每日一句」 | **小编的话**（几百字的点评散文） |
 *
 * 所以这里不直接把上游 JSON 丢给组件，而是**先归一化**：
 * 数字/字符串统一成字符串、缺失统一成 null、把 `translation` 里真正的点评筛出来。
 * 组件只认 `DailySentence` 一个形状，上游怎么变都不影响渲染。
 *
 * 归一化是纯函数（不碰网络），因此可以直接单测 —— 见 sentence.test.ts。
 */

/**
 * 宽松文本：上游字段可能是字符串、数字或 null，一律转成「非空字符串 | null」。
 *
 * 为什么不用 zod 卡：这个上游太松（同一字段跨年份类型都不同），而且 zod v4 对
 * **缺失的键**会跳过 transform（实测 `sid` 缺失时拿到的是 undefined 而不是 null），
 * 用它反而多一层隐性行为。这里手工归一，行为一眼可见。
 *
 * `0` / `false` 当成「没有」：老数据里 `tts: 0`、`sharePicture: false` 就是从缺值
 * 变来的，当成字符串会渲染出 `<audio src="0">` 这种坏东西。
 */
function asText(v: unknown): string | null {
  if (v == null || v === 0 || v === false) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** 宽松数字：非法值回落到 fallback */
function asNum(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export type Unwrapped = { ok: true; data: unknown } | { ok: false; reason: string };

/**
 * 拆上游信封。
 *
 * 三个接口都返回 `{ errno, errmsg, data }`：
 *
 *     {"errno":0,"errmsg":"","data":{"content":"Warm bread…"}}
 *
 * **这一步漏掉的后果特别隐蔽**：归一化只看到 `errno/errmsg` 两个字段，找不到
 * `content`，于是每条都判成「无法识别」→ 页面三个面板全变空态，
 * 而网络、状态码、超时全都正常（真踩过）。所以单独做成纯函数并单测。
 *
 * 兼容性：哪天上游去掉信封（直接返回实体），这里原样透传。
 */
export function unwrapEnvelope(body: unknown): Unwrapped {
  if (!isRecord(body)) return { ok: true, data: body };
  if ('errno' in body) {
    const errno = Number(body.errno);
    if (Number.isFinite(errno) && errno !== 0) {
      return { ok: false, reason: `upstream-errno-${errno}` };
    }
  }
  if ('data' in body) return { ok: true, data: body.data };
  return { ok: true, data: body };
}

export type DailySentence = {
  /** 上游 id（列表去重用） */
  id: string;
  /** 期号，形如 `6081`；老数据没有则为空串 */
  sid: string;
  /** 日期 `YYYY-MM-DD`；缺失为空串 */
  date: string;
  /** 英文原句 —— 唯一必填字段 */
  en: string;
  /** 中文译文 */
  zh: string;
  /** 官方配音 mp3；老数据为 null */
  tts: string | null;
  /** 卡面配图（中等尺寸，用于内嵌展示） */
  image: string | null;
  /** 分享图（带文字的成品图，新窗口打开） */
  share: string | null;
  /** 栏目名，如「词霸每日一句」 */
  caption: string | null;
  /** 小编的话（仅老数据有；占位文案会被过滤） */
  commentary: string | null;
};

export type DailyArchive = {
  /** 上游总条数 */
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
  items: DailySentence[];
};

/**
 * `translation` 里哪些是「小编的话」。
 *
 * 新版上游把「新版每日一句」这类**栏目占位**塞进 translation，直接展示会显得很傻；
 * 老数据的点评散文动辄几百字，才是值得展示的内容。用长度 + 白名单把它们分开：
 * 占位词直接排除，24 字以下的一律不展示（点评不会那么短）。
 */
const TRANSLATION_PLACEHOLDERS = new Set([
  '新版每日一句',
  '每日一句',
  '词霸每日一句',
  '金山词霸每日一句',
]);

export function commentaryOf(translation: string | null, note: string | null): string | null {
  if (!translation) return null;
  if (translation === note) return null; // 与译文重复就不再重复一遍
  if (TRANSLATION_PLACEHOLDERS.has(translation)) return null;
  if (translation.length < 24) return null;
  return translation;
}

/** 单条归一化：没有英文原句就没有可展示的东西 → null */
export function normalizeSentence(raw: unknown): DailySentence | null {
  if (!isRecord(raw)) return null;
  const en = asText(raw.content);
  if (!en) return null;

  const zh = asText(raw.note);
  return {
    id: asText(raw._id) ?? asText(raw.date) ?? en,
    sid: asText(raw.sid) ?? '',
    date: asText(raw.date) ?? '',
    en,
    zh: zh ?? '',
    tts: asText(raw.tts),
    // 展示用中等尺寸；老数据没有 middlePicture，逐级回落
    image:
      asText(raw.middlePicture) ??
      asText(raw.picture) ??
      asText(raw.largePicture) ??
      asText(raw.smallPicture),
    share: asText(raw.sharePicture) ?? asText(raw.largePicture),
    caption: asText(raw.caption),
    commentary: commentaryOf(asText(raw.translation), zh),
  };
}

/**
 * 列表归一化。
 *
 * 两个刻意的宽容：
 *   · `data` 逐条过滤 —— 一条坏数据不该带走整页；
 *   · `totalPages` 缺失时按 count/pageSize 现算 —— 分页控件不能因为上游少个字段就消失。
 */
export function normalizeArchive(
  raw: unknown,
  fallbackPage = 1,
  fallbackSize = 20,
): DailyArchive {
  const r = isRecord(raw) ? raw : {};
  const items = Array.isArray(r.data)
    ? r.data.map(normalizeSentence).filter((s): s is DailySentence => s !== null)
    : [];

  const page = asNum(r.currentPage, fallbackPage);
  const pageSize = asNum(r.pageSize, fallbackSize);
  const count = asNum(r.count, items.length);
  const totalPages = asNum(r.totalPages, Math.max(1, Math.ceil(count / pageSize)));

  return { count, page, pageSize, totalPages, items };
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/**
 * `YYYY-MM-DD` → 「2026 年 9 月 17 日 · 星期四」
 *
 * 刻意**不经过本地时区**：服务端跑在 UTC，客户端在东八区，用 `new Date(iso)`
 * 会让同一天在两边差出一天（甚至在 23:00–01:00 之间显示成前一天）。
 * 这里按年月日直接构造 UTC 时间取星期几，两端结果必然一致。
 */
export function formatCnDate(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(iso ?? '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return `${y} 年 ${mo} 月 ${d} 日 · ${WEEKDAYS[dow]}`;
}

/** `2026-09-17` → `09-17`（往期列表的行首日期，年份交给月份分组头） */
export function formatShortDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(iso ?? '').trim());
  const [, , mo, d] = m ?? [];
  if (!mo || !d) return '';
  return `${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** `2026-09` → 「2026 年 9 月」（往期列表的月份分组头） */
export function formatMonthLabel(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{1,2})/.exec(String(iso ?? '').trim());
  if (!m) return null;
  return `${m[1]} 年 ${Number(m[2])} 月`;
}
