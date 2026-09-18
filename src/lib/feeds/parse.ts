/**
 * RSS / Atom 订阅源解析（听力播客 + 阅读文章共用）
 * ============================================================================
 * 这里刻意**不引入 XML 依赖**，而是针对订阅源的三种格式写一个小扫描器。理由：
 *
 *   1. 需要处理的只是三种固定结构（RSS 2.0 / RSS 1.0 RDF / Atom），
 *      字段都是叶子节点，不存在任意 XML 的深层嵌套；
 *   2. 十个真实源的形态已经全部实测过（见 docs/FEEDS-MODULE.md），
 *      扫描器按实测形态写，并由 parse.sample.test.ts 拿真样本回归；
 *   3. 少一个依赖就少一处供应链与锁文件风险 —— 本项目的原则是能不引就不引。
 *
 * 实测踩到的四个坑（每一条都有对应代码 + 测试）：
 *
 *   · **BBC 的音频是 http://**。站点是 https，浏览器会按混合内容直接拦掉，
 *     所以解析时要把白名单主机升级成 https（实测升级后 206 + Content-Range 正常）。
 *   · **ScienceDaily 的日期是 `Thu, 17 Sep 2026 10:44:25 EDT`** —— 带时区缩写，
 *     `Date.parse` 对 EDT 这类缩写不可靠（会得到 Invalid Date），必须自建时区表。
 *   · **时长有三种写法**：BBC 是纯秒 `381`、TED 是 `21:42`、还有 `1:02:03`。
 *   · **Science 的 enclosure 是图片**（`type="image/jpg"`），
 *     不能见到 enclosure 就当音频 —— 要按 type / medium 判定。
 *
 * 另一个工程点：TED 的订阅源 8.5MB / 2811 条，全量解析会白烧 CPU 与内存。
 * 订阅源天然**新条目在前**，所以先按标签边界截到前 N 条再解析（`capItems`）。
 */

export type FeedKind = 'podcast' | 'article';

export type FeedSource = {
  id: string;
  /** 节目 / 媒体名 */
  title: string;
  /** 列表里用的短名 */
  short: string;
  kind: FeedKind;
  /** 订阅源地址 */
  url: string;
  /** 人类可读的主页（点了去官网） */
  homeUrl: string;
  /** 语言标签，用于列表上的小签 */
  lang: 'en' | 'zh' | 'mix';
  /** 分组说明，例如「慢速英语」「科学」 */
  genre: string;
  /** 一句话介绍（UI 上的节目简介） */
  note: string;
  /**
   * 上游格式。
   *   'rss'（默认）= XML 订阅源，走 parseFeed；
   *   'librivox'    = LibriVox JSON 列表 + 每本书的 RSS（见 librivox.ts）。
   */
  format?: 'rss' | 'librivox';
};

export type FeedAudio = {
  url: string;
  type: string;
  bytes: number | null;
  durationSec: number | null;
};

export type FeedItem = {
  id: string;
  title: string;
  /** 原文链接 */
  url: string;
  /** 纯文本摘要（截断到 SUMMARY_MAX） */
  summary: string;
  /** 纯文本正文（多段用 \n\n 分隔；没有 content:encoded 时等于摘要） */
  body: string;
  /** ISO 时间；解析不出来为 null */
  publishedAt: string | null;
  audio: FeedAudio | null;
  image: string | null;
  sourceId: string;
  /**
   * 分组名（列表里会渲染一条分组头）。
   * 只有 LibriVox 用：一个「节目」下其实是多本书，用书名把章节分组。
   */
  group?: string | null;
};

export type FeedChannel = {
  id: string;
  title: string;
  description: string;
  homeUrl: string;
  image: string | null;
  items: FeedItem[];
};

const SUMMARY_MAX = 420;
/** 单次解析最多取的条目数（订阅源新条目在前） */
export const MAX_ITEMS = 30;
/** 超过这个体积才走「解析前截断」 */
const CAP_THRESHOLD = 300_000;

/* ==========================================================================
   一、XML 基础工具
   ========================================================================== */

/** 命名实体（订阅源里最常见的那些；其余走数字实体） */
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '\u2019',
  lsquo: '\u2018',
  rdquo: '\u201d',
  ldquo: '\u201c',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  eacute: '\u00e9',
  egrave: '\u00e8',
  agrave: '\u00e0',
  ccedil: '\u00e7',
  uuml: '\u00fc',
  ouml: '\u00f6',
  auml: '\u00e4',
  szlig: '\u00df',
  middot: '\u00b7',
  bull: '\u2022',
  deg: '\u00b0',
  laquo: '\u00ab',
  raquo: '\u00bb',
};

/** 实体解码：命名 + 十进制 + 十六进制（订阅源里三种都会出现） */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = NAMED[body] ?? NAMED[body.toLowerCase()];
    return named ?? whole;
  });
}

/** 取出 CDATA 内容；没有 CDATA 就返回原串 */
function unwrapCdata(s: string): string {
  const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
  return m ? (m[1] ?? '') : s;
}

/**
 * 取第一个 `<tag …>…</tag>` 的内部文本（或自闭合标签的 null）。
 *
 * 用「找开标签 + 找对应闭标签」而不是正则匹配整体：标签可能带任意属性，
 * 内部还可能有 HTML（`<description><p>…</p></description>` 这种不带 CDATA 的写法真存在）。
 * HTML 里出现字面量 `</tag>` 的概率极低，这份简单换来的是可读性。
 */
function tag(xml: string, name: string): string | null {
  const open = new RegExp(`<${name}(\\s[^>]*)?>`, 'i').exec(xml);
  if (!open) return null;
  const start = open.index + open[0].length;
  if (open[0].endsWith('/>')) return '';
  const close = new RegExp(`</${name}\\s*>`, 'i').exec(xml.slice(start));
  if (!close) return null;
  return unwrapCdata(xml.slice(start, start + close.index));
}

/** 取标签上的属性值 */
function attr(tagText: string | null, name: string): string | null {
  if (!tagText) return null;
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tagText);
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : null;
}

/** 取第一个符合名字的**完整标签**文本（用于读属性） */
function tagWithAttrs(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}(\\s[^>]*?)?/?>`, 'i').exec(xml);
  return m ? m[0] : null;
}

/**
 * Atom 的文章链接在 `<link href=… rel=…>` 的属性里（RSS 是 `<link>文本</link>`）。
 * 优先 rel="alternate"（Atom 规范里它就是「正文地址」），没有就取第一个带 href 的。
 */
function atomLink(xml: string): string | null {
  const re = /<link(\s[^>]*?)?\/?>/gi;
  let first: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const href = attr(m[0], 'href');
    if (!href) continue;
    if ((attr(m[0], 'rel') ?? 'alternate') === 'alternate') return href;
    if (!first) first = href;
  }
  return first;
}

/**
 * 解析前截断：只保留前 n 个 item/entry。
 *
 * TED 的源 8.5MB / 2811 条，全量解析在 serverless 上是纯浪费（我们只展示最新 30 条）。
 * 做法是按标签边界切，再补上根闭合标签 —— 切点一定落在标签之间，故结构仍然合法。
 *
 * `threshold` 是「小源就别扫了」的短路：绝大多数源只有几十条、几百 KB，
 * 扫描一遍虽然不贵，但没必要。
 */
export function capItems(xml: string, n = MAX_ITEMS, threshold = CAP_THRESHOLD): string {
  if (xml.length < threshold) return xml;
  const re = /<(item|entry)(\s[^>]*)?>/gi;
  let count = 0;
  let cutAt = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    count++;
    if (count === n + 1) {
      cutAt = m.index;
      break;
    }
  }
  if (cutAt < 0) return xml;
  const head = xml.slice(0, cutAt);
  if (/<rdf:RDF[\s>]/i.test(xml)) return `${head}</rdf:RDF>`;
  if (/<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml)) return `${head}</feed>`;
  return `${head}</channel></rss>`;
}

/* ==========================================================================
   二、字段级解析
   ========================================================================== */

/**
 * HTML → 纯文本；块级标签之间补空行，保住段落结构（阅读模块要用）。
 *
 * ⚠ 顺序很讲究：**先解码实体、再剥标签、最后再解码一次**。
 * feedx 的 China Daily / BBC 中文把整段 HTML 实体转义后塞进 description
 * （`&lt;div&gt;&lt;p&gt;正文&lt;/p&gt;&lt;/div&gt;`），若先剥标签再解码，
 * 解出来的标签就留在正文里了（真踩过，样本回归里挂了两个源）。
 * 末尾那次解码对付的是双重转义（`&amp;lt;`）。
 */
export function htmlToText(html: string): string {
  const stripped = decodeEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|h[1-6]|blockquote|figcaption|tr)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '· ')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(stripped)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const SUMMARY_KEEP = /[<>]/;

/** 摘要：抹掉 HTML，压成一行；超长按句号/空格截断并加省略号 */
export function toSummary(html: string, max = SUMMARY_MAX): string {
  const text = htmlToText(html).replace(/\n+/g, ' ').trim();
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const cut = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('。 '), slice.lastIndexOf(' '));
  const body = (cut > max * 0.6 ? slice.slice(0, cut) : slice).trimEnd();
  return `${body}${SUMMARY_KEEP.test(body) ? '' : '…'}`;
}

/** 时长：`381`（秒） / `21:42` / `1:02:03` 三种写法 */
export function parseDuration(v: string | null | undefined): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const sec = Number(s);
    return sec > 0 && sec < 60 * 60 * 12 ? sec : null;
  }
  const [a, b, c] = s.split(':').map((x) => Number(x.replace(/[^\d]/g, '')));
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (c == null) return a * 60 + b;
  if (!Number.isFinite(c)) return null;
  return a * 3600 + b * 60 + c;
}

/**
 * 时区缩写表。
 *
 * ScienceDaily 用 `EDT`，而 `Date.parse('… EDT')` 在 Node/Chrome 上会得到 Invalid Date
 * （缩写不是规范的一部分，实现各异）—— 这类日期一旦解析失败，列表排序就全乱，
 * 所以宁可自己查表。
 */
const TZ_ABBR: Record<string, number> = {
  UT: 0,
  UTC: 0,
  GMT: 0,
  Z: 0,
  EST: -5,
  EDT: -4,
  CST: -6,
  CDT: -5,
  MST: -7,
  MDT: -6,
  PST: -8,
  PDT: -7,
  AKST: -9,
  HST: -10,
  BST: 1,
  CET: 1,
  CEST: 2,
  EET: 2,
  EEST: 3,
  IST: 5.5,
  JST: 9,
  KST: 9,
  AEST: 10,
  AEDT: 11,
  NZST: 12,
  CST8: 8,
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** 日期：RFC822（含时区缩写）/ ISO8601 / `2026-09-18`，统一出 ISO 字符串 */
export function parseDate(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;

  // ① ISO8601（含偏移）——Nature 用 `dc:date` 给的是 `2026-09-18`
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/.test(s)) {
    const d = new Date(s.length <= 10 ? `${s}T00:00:00Z` : s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  // ② RFC822：`Thu, 17 Sep 2026 08:34:00 +0000` / `… 10:44:25 EDT`
  const m = /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|[A-Za-z]{1,5})?/.exec(
    s,
  );
  if (!m) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const monthName = m[2] ?? '';
  const mo = MONTHS.indexOf(monthName.toLowerCase());
  if (mo < 0) return null;
  const year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
  const zone = m[7] ?? 'GMT';
  let offsetMin = 0;
  if (/^[+-]\d{4}$/.test(zone)) {
    offsetMin = (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3))) * (zone[0] === '-' ? -1 : 1);
  } else {
    const hours = TZ_ABBR[zone.toUpperCase()];
    // 查不到就按 UTC 处理：宁可差几小时，也好过整条丢掉
    offsetMin = hours == null ? 0 : Math.round(hours * 60);
  }
  const ms = Date.UTC(
    year,
    mo,
    Number(m[1]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? 0),
  ) - offsetMin * 60_000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * http → https 升级（只对音频主机白名单）。
 *
 * BBC 的 enclosure 是 `http://open.live.bbc.co.uk/…`，在 https 站点里会被浏览器
 * 当混合内容拦掉。实测这些主机的 https 端点同样返回 206 + Content-Range（可拖动），
 * 所以在解析阶段直接升级协议，比再搭一层媒体代理简单得多（也避开了
 * serverless 响应体积上限）。
 */
const HTTPS_ONLY_HOSTS = [
  'open.live.bbc.co.uk',
  'podcasts.files.bbci.co.uk',
  'downloads.bbc.co.uk',
];

export function upgradeAudioUrl(url: string): string {
  if (!url.startsWith('http://')) return url;
  try {
    const u = new URL(url);
    if (HTTPS_ONLY_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) {
      u.protocol = 'https:';
      return u.toString();
    }
  } catch {
    return url;
  }
  return url;
}

function firstImage(xml: string): string | null {
  const itunes = attr(tagWithAttrs(xml, 'itunes:image'), 'href');
  if (itunes) return itunes;
  const media = attr(tagWithAttrs(xml, 'media:thumbnail'), 'url');
  if (media) return media;
  const content = attr(tagWithAttrs(xml, 'media:content'), 'url');
  if (content && /\.(jpe?g|png|webp)(\?|$)/i.test(content)) return content;
  return null;
}

/**
 * 音频：从 enclosure / media:content 里挑。
 *
 * Science 的 enclosure 是 `type="image/jpg"` 的配图，BBC 则用 `medium="audio"`，
 * 所以判定条件是「type 以 audio/ 开头 或 medium=audio」，图片一律不进 audio 字段。
 */
function pickAudio(xml: string): FeedAudio | null {
  const candidates: string[] = [];
  const re = /<enclosure(\s[^>]*?)?\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) candidates.push(m[0]);
  const mc = /<media:content(\s[^>]*?)?\/?>/gi;
  while ((m = mc.exec(xml))) candidates.push(m[0]);
  for (const c of candidates) {
    const url = attr(c, 'url');
    const type = attr(c, 'type') ?? '';
    const medium = attr(c, 'medium') ?? '';
    if (!url) continue;
    if (!/^audio\//i.test(type) && medium !== 'audio') continue;
    const len = attr(c, 'length') ?? attr(c, 'fileSize');
    const bytes = len && /^\d+$/.test(len) ? Number(len) : null;
    return { url: upgradeAudioUrl(url), type: type || 'audio/mpeg', bytes, durationSec: null };
  }
  return null;
}

/* ==========================================================================
   三、条目 / 频道
   ========================================================================== */

function normalizeItem(itemXml: string, source: FeedSource): FeedItem | null {
  const rssTitle = tag(itemXml, 'title');
  const atomTitle = rssTitle ?? tag(itemXml, 'media:title');
  const title = htmlToText(atomTitle ?? '').replace(/\s+/g, ' ').trim();
  if (!title) return null;

  // 正文优先 content:encoded，其次 description/summary/itunes:summary
  const contentRaw =
    tag(itemXml, 'content:encoded') ??
    tag(itemXml, 'description') ??
    tag(itemXml, 'summary') ??
    tag(itemXml, 'itunes:summary') ??
    '';
  const body = htmlToText(contentRaw);
  const summary = toSummary(contentRaw || title);

  // 链接：Atom 在属性里；RSS 是文本；RDF 用 rdf:about
  const link =
    atomLink(itemXml) ??
    tag(itemXml, 'link')?.trim() ??
    attr(tagWithAttrs(itemXml, 'item'), 'rdf:about') ??
    '';
  const url = (link ?? '').trim();

  const dur = parseDuration(tag(itemXml, 'itunes:duration'));
  const audio = pickAudio(itemXml);
  if (audio && dur != null) audio.durationSec = dur;

  const published =
    parseDate(tag(itemXml, 'pubDate')) ??
    parseDate(tag(itemXml, 'dc:date')) ??
    parseDate(tag(itemXml, 'published')) ??
    parseDate(tag(itemXml, 'updated')) ??
    parseDate(tag(itemXml, 'date'));

  // 图片：条目自带的优先，否则留空（频道图在 UI 上兜底）
  const image = firstImage(itemXml) ?? attr(tagWithAttrs(itemXml, 'enclosure[^>]*type="image[^"]*"'), 'url');

  return {
    id: tag(itemXml, 'guid')?.trim() || url || `${source.id}:${title}`,
    title,
    url,
    summary,
    body: body || summary,
    publishedAt: published,
    audio,
    image,
    sourceId: source.id,
  };
}

function splitItems(xml: string): string[] {
  const out: string[] = [];
  const re = /<(item|entry)(\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[0]);
  return out;
}

/** 解析一份订阅源。结构不可识别时返回 null（调用方走空态，不抛错） */
export function parseFeed(xmlRaw: string, source: FeedSource): FeedChannel | null {
  const xml = capItems(xmlRaw.replace(/^\uFEFF/, ''));
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml)) return null;

  const items = splitItems(xml);

  // 频道级字段只在「第一个 item 之前」找，避免把条目标题当成频道标题
  const first = items[0];
  const firstItemAt = first ? xml.indexOf(first) : xml.length;
  const header = xml.slice(0, firstItemAt);

  const channelTitle = htmlToText(tag(header, 'title') ?? '').trim() || source.title;
  const channelDesc = toSummary(tag(header, 'description') ?? tag(header, 'subtitle') ?? '', 200);
  const channelLink =
    atomLink(header) ?? tag(header, 'link')?.trim() ?? source.homeUrl ?? '';
  const channelImage = firstImage(header);

  const parsed = items
    .map((it) => normalizeItem(it, source))
    .filter((x): x is FeedItem => x !== null);

  return {
    id: source.id,
    title: channelTitle,
    description: channelDesc,
    homeUrl: (channelLink || source.homeUrl).trim(),
    image: channelImage,
    items: parsed,
  };
}
