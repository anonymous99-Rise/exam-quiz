/**
 * 网页正文提取（阅读页「读全文」 + 播放器「文稿」共用）
 * ============================================================================
 * 为什么不用 Readability 那类库：这一层只需要「拿到主要正文段落」，
 * 而引入一个依赖要连带 jsdom/dom 解析器（几百 KB + 构建风险）。
 * 这里用一个**轻量容器栈扫描器**：顺序扫标签、维护当前所在的 div/section/article 路径，
 * 把每个段落归到它的容器路径上，最后挑「非导航类、字数最多」的那条路径。
 *
 * 实测的三种页面（决定了必须做「抓不到就说清楚」）：
 *
 *   · ScienceDaily —— 正文在 `#story_text`，静态 HTML 里就有 15+ 段 ✅
 *   · Nature / Science.org —— Cloudflare 挑战页（3KB 的 `Client Challenge`）+ 正文本身付费 ❌
 *   · VOA 节目页 —— 文稿是**前端动态加载**的，初始 HTML 只有 4 段 ❌
 *
 * 所以这里返回 `{ ok:false, reason }` 而不是硬凑一段文字：UI 会如实告诉用户
 * 「这个页面抓不到正文，去官网看」，这比给一段导航栏文字当正文有用得多。
 */

/** 段落块：正文段落 + 小标题（小标题由长度与标点启发式判断） */
export type Block = { kind: 'p' | 'h'; text: string };

/**
 * 「算不算抓到了正文」的下限。
 *
 * 实测 VOA 节目页能抓出 228 字，但那只是页面说明、不是文稿 ——
 * 若把它当全文展示，用户会以为「文稿就这么点」。低于这个阈值一律按抓取失败处理，
 * 由 UI 如实说明并给出官网入口。
 */
export const MIN_USEFUL_CHARS = 600;

export type ExtractResult =
  | { ok: true; blocks: Block[]; chars: number; strategy: string }
  | { ok: false; reason: 'blocked' | 'no-content' | 'empty' };

/** 反爬/验证页的典型特征（拿到这些说明对面没给内容，别把挑战页当正文） */
const CHALLENGE = [
  /Client Challenge/i,
  /Just a moment\.{0,3}/i,
  /cf-browser-verification/i,
  /cf_chl_/i,
  /enable JavaScript and cookies to continue/i,
  /Checking your browser before accessing/i,
  /Access Denied/i,
  /Attention Required! \| Cloudflare/i,
];

/** 容器路径里出现这些词就当成导航/页脚/推荐位 */
const NOISE = [
  'nav',
  'menu',
  'footer',
  'header',
  'sidebar',
  'aside',
  'comment',
  'related',
  'share',
  'social',
  'promo',
  'newsletter',
  'cookie',
  'banner',
  'subscribe',
  'breadcrumb',
  'most-read',
  'mostread',
  'recommend',
  'copyright',
  'advert',
  'sponsor',
  'toolbar',
  'search',
  'pagination',
  'tag-list',
  'meta',
];

/** 容器路径里出现这些词说明更可能是正经正文 */
const PREFER = ['article', 'content', 'body', 'story', 'post', 'entry', 'text', 'main', 'transcript', 'prose'];

type Frame = { key: string; noise: boolean; depth: number };

function attrOf(raw: string): string {
  const id = /\bid\s*=\s*("([^"]*)"|'([^']*)')/i.exec(raw);
  const cls = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/i.exec(raw);
  const idv = (id?.[2] ?? id?.[3] ?? '').trim();
  const clsv = (cls?.[2] ?? cls?.[3] ?? '').trim();
  return `${idv} ${clsv}`.trim().toLowerCase();
}

/** 预处理：去掉一定不是正文的部分（脚本/样式/表单/注释/内嵌框架） */
export function stripNonContent(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ');
}

/** 页面是不是「被反爬拦住」而不是「没内容」 */
export function looksBlocked(html: string): boolean {
  // 挑战页只有几 KB，且命中典型特征
  if (html.length > 60_000) return false;
  return CHALLENGE.some((re) => re.test(html));
}

/** HTML 片段 → 纯文本（复用 parse.ts 的同名思路，但这里要保留段落边界） */
function textOf(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&#8217;/g, "'")
    .replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"')
    .replace(/&mdash;|&#8212;/g, '—')
    .replace(/&hellip;/g, '…')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : _;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 提取正文。
 *
 * 做法：顺序扫标签维护容器栈 → 把段落归到容器路径 → 按路径聚合字数 → 挑最优路径。
 * 这样不需要 DOM 解析器，也能把「导航栏里的一句话」和「正文段落」分开。
 */
export function extractMainText(html: string): ExtractResult {
  if (!html) return { ok: false, reason: 'empty' };
  // 先判「被拦」：挑战页本身很短，顺序颠倒会误判成 empty
  if (looksBlocked(html)) return { ok: false, reason: 'blocked' };
  if (html.length < 200) return { ok: false, reason: 'empty' };

  const body = stripNonContent(html);
  const stack: Frame[] = [];
  const byPath = new Map<string, { blocks: Block[]; chars: number; noise: boolean; prefer: boolean }>();
  let currentKey = 'root';
  let buffer = '';
  let bufferTag = '';

  const flush = () => {
    const text = textOf(buffer);
    buffer = '';
    if (text.length < 2) return;
    const entry = byPath.get(currentKey) ?? {
      blocks: [],
      chars: 0,
      noise: stack.some((f) => f.noise),
      prefer: PREFER.some((w) => currentKey.includes(w)),
    };
    // 短行且无句末标点 → 小标题（英文标题通常不以句号结尾）
    const isHeading = text.length <= 90 && !/[.!?。！？]["')\]]?$/.test(text);
    entry.blocks.push({ kind: isHeading ? 'h' : 'p', text });
    entry.chars += text.length;
    byPath.set(currentKey, entry);
  };

  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  const CONTAINERS = [
    'div',
    'section',
    'article',
    'main',
    'aside',
    'nav',
    'header',
    'footer',
    'ul',
    'ol',
    'figure',
    'table',
    'td',
    'li',
  ];
  const BLOCKS = ['p', 'h1', 'h2', 'h3', 'h4', 'blockquote'];

  let m: RegExpExecArray | null;
  let lastIndex = 0;
  while ((m = re.exec(body))) {
    /*
     * 关键：把**标签之间的文本**收进 buffer。
     * 第一版只顾着解析标签、从不取文本，于是永远拿不到段落（真踩过 —— 所有页面都 no-content）。
     * 只在「正在收集某个块」时累积，避免把标签之间的空白/脚本残渣当正文。
     */
    if (bufferTag) buffer += body.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;

    const closing = m[1] === '/';
    const tag = (m[2] ?? '').toLowerCase();
    const raw = m[3] ?? '';

    if (BLOCKS.includes(tag)) {
      if (!closing) {
        flush();
        bufferTag = tag;
      } else if (bufferTag === tag) {
        flush();
        bufferTag = stack.length ? 'loose' : '';
      }
      continue;
    }

    if (CONTAINERS.includes(tag)) {
      if (!closing) {
        const attrs = attrOf(raw);
        const key = `${tag}${attrs ? `.${attrs.split(/\s+/)[0]}` : ''}`;
        const noise = NOISE.some((w) => attrs.includes(w));
        // 进入子容器前先结算父层的散文本
        flush();
        bufferTag = 'loose';
        stack.push({ key, noise, depth: stack.length });
        currentKey = stack.map((f) => f.key).join('>');
      } else {
        flush();
        // 不校验标签名是否匹配（HTML 常有未闭合标签），只保证不崩
        if (stack.length) stack.pop();
        currentKey = stack.length ? stack.map((f) => f.key).join('>') : 'root';
        bufferTag = stack.length ? 'loose' : '';
      }
      continue;
    }

    // 其它标签（span/a/em/strong…）：只要在收集状态，它们之间的文本会自然累加到 buffer
    if (!bufferTag) {
      bufferTag = 'loose';
      buffer = '';
    }
  }
  if (bufferTag) flush();

  if (!byPath.size) return { ok: false, reason: 'no-content' };

  // 选择最优容器：非导航优先 → 有「正文类」关键词优先 → 字数多优先
  const ranked = [...byPath.entries()]
    .filter(([, v]) => v.chars >= 200)
    .sort((a, b) => {
      const sa = (a[1].noise ? 0 : 1) * (a[1].prefer ? 1.5 : 1) * a[1].chars;
      const sb = (b[1].noise ? 0 : 1) * (b[1].prefer ? 1.5 : 1) * b[1].chars;
      return sb - sa;
    });

  const best = ranked[0];
  if (!best) return { ok: false, reason: 'no-content' };

  const blocks = best[1].blocks.filter((b) => b.text.length > 1).slice(0, 200);
  const chars = blocks.reduce((n, b) => n + b.text.length, 0);
  if (chars < 200) return { ok: false, reason: 'no-content' };

  return {
    ok: true,
    blocks,
    chars,
    strategy: best[0].slice(0, 120),
  };
}
