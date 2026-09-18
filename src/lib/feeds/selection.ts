/**
 * 划词翻译的纯逻辑（划词范围整形 + 两个上游的响应解析）
 *
 * 拆成纯函数是为了**可测**：划词交互本身（选区、浮层定位）只能在浏览器里验，
 * 但「选中的文本该按词/短语/句子处理」和「上游 JSON 怎么取译文」这两件事
 * 是纯计算，写错一次就会让浮层永远空着 —— 所以单独钉住。
 */

/** 划词上限：超过就没必要逐段翻了，也给上游留出余量 */
export const MAX_SELECTION = 400;

export type SelectionKind = 'word' | 'phrase' | 'sentence';

export type Selection = {
  /** 规整后的文本（空白折叠、截断） */
  text: string;
  kind: SelectionKind;
  /** 词数（中文按整段算 1） */
  words: number;
  /** 是否被截断 */
  clipped: boolean;
};

/**
 * 选区整形。
 *
 * 三类分开是为了给不同的默认动作：单词直接给词义，短语/句子给整句译文。
 * 判据刻意宽松（按词数与长度），因为「划了半句」也该能翻 —— 用户不会精确选区。
 */
export function shapeSelection(raw: string): Selection | null {
  const text = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  // 纯符号/空白不翻
  if (!/[\p{L}\p{N}]/u.test(text)) return null;

  const clipped = text.slice(0, MAX_SELECTION);
  const words = clipped.split(' ').filter(Boolean).length;
  /*
   * 中文不能按空格数判断：`认知弹性有助于预测老年痴呆症。` 是 1 个「词」（没有空格）
   * 却是整整一句。所以中文改按**字符数**分档（2–4 字当词、≤12 字当短语），
   * 英文才用词数 + 长度。
   */
  const hasCjk = /[\u4e00-\u9fff]/.test(clipped);
  const kind: SelectionKind = hasCjk
    ? clipped.length <= 4
      ? 'word'
      : clipped.length <= 12
        ? 'phrase'
        : 'sentence'
    : words <= 1 && clipped.length <= 24
      ? 'word'
      : words <= 6 && clipped.length <= 64
        ? 'phrase'
        : 'sentence';
  return { text: clipped, kind, words, clipped: clipped.length < text.length };
}

/** 有道的词典/翻译网页（词与句都能查，手机版对长句更友好） */
export function youdaoUrl(text: string): string {
  return `https://www.youdao.com/result?word=${encodeURIComponent(text)}&lang=en`;
}

/**
 * 解析有道 `aidemo/trans` 的响应。
 *
 * 实测结构（词与句一致）：
 *   { errorCode: "0", query, translation: ["译文"], tSpeakUrl: "…mp3", mTerminalDict: { url } }
 */
export function parseYoudaoTranslation(body: unknown): { text: string; speak: string | null } | null {
  const j = body as {
    errorCode?: string | number;
    translation?: unknown;
    tSpeakUrl?: unknown;
  } | null;
  if (!j || typeof j !== 'object') return null;
  const code = String(j.errorCode ?? '');
  if (code && code !== '0') return null;
  const first = Array.isArray(j.translation) ? j.translation[0] : j.translation;
  const text = typeof first === 'string' ? first.trim() : '';
  if (!text) return null;
  const speak = typeof j.tSpeakUrl === 'string' && j.tSpeakUrl.startsWith('http') ? j.tSpeakUrl : null;
  return { text, speak };
}

/** 解析 MyMemory 的响应（备用源：有道挂了还有一条路） */
export function parseMyMemoryTranslation(body: unknown): string | null {
  const j = body as { responseData?: { translatedText?: unknown }; responseStatus?: unknown } | null;
  const text = j?.responseData?.translatedText;
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  // MyMemory 在限流时会回一句话而不是译文
  if (!trimmed || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(trimmed)) return null;
  return trimmed;
}
