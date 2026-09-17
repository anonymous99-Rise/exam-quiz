/**
 * 题库导入归一化
 * ============================================================================
 * 导入的真实痛点是「人工录入 / Excel 导出的文本千奇百怪」：
 *   全角字母数字、选项有 `A)` / `(A)` / `a.` / `（A）` / `A、` 五种写法、
 *   答案带点、说明标签带全角冒号、CRLF、连续空行、零宽字符……
 *
 * 这里是**纯函数**，导入器与测试共用同一份实现 —— 不把正则散在 CLI 里。
 * 原则：只做「等价改写」，绝不改动题面语义。
 */

/* ---------- 字符级 ---------- */

/**
 * 全角 → 半角（ASCII 可见字符 + 表意空格）。
 *
 * ⚠ 只可用于**结构性字段**：表头、选项字母、答案、标签。
 *   绝不能用在中文正文（题干翻译、选项翻译、解析文字）上 ——
 *   全角逗号「，」是 U+FF0C，落在 FF01–FF5E 区间内，会被转成半角「,」，
 *   而句号「。」是 U+3002，不在区间内、保持不变 ——
 *   结果是同一句中文里「，」变半角、「。」还是全角，标点被搞成两套。
 *   正文请用 cleanText()。
 */
export function toHalfWidth(s: string): string {
  return s
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');
}

/** 去掉零宽字符与 BOM（从网页/Excel 复制时常见，肉眼不可见却会破坏字符串匹配） */
export function stripInvisible(s: string): string {
  return s.replace(/[\u200B-\u200D\uFEFF\u2060]/g, '');
}

/**
 * 通用文本清理：去不可见字符、统一换行、去行尾空格、压缩连续空行。
 *
 * ⚠ 曾经在这里加过「去掉不成对的尾部引号」想修复 CSV 往返差异，**已回退**：
 * 扫描发现所谓「不成对」绝大多数是正常的英文撇号（`Lions' tracks.`、`don't`），
 * 按奇偶去删会误伤合法标点（而且实测差异反而从 2 套变 3 套）。
 * 往返差异的真实来源是选项文本尾部的个别字符，属导出/导入侧的规范化，
 * 不影响站内渲染 —— 记为已知项，不用这种「看起来能修好」的猜测式规则去动数据。
 */
export function cleanText(s: string): string {
  return stripInvisible(String(s ?? '').replace(/\r\n?/g, '\n'))
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ---------- 字段级 ---------- */

/**
 * 答案归一化：'c' → 'C'，'Ｃ' → 'C'，' C. ' → 'C'，多选 'a b' → 'AB'
 * 非法输入抛错，由调用方作为**错误**拦截（不静默丢弃）。
 */
export function normalizeAnswer(raw: string): string {
  const s = toHalfWidth(stripInvisible(String(raw ?? '')))
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (!s) throw new Error(`答案为空或非法: ${JSON.stringify(raw)}`);
  // 去重并排序，保证 'BA' 与 'AB' 等价
  return [...new Set(s.split(''))].sort().join('');
}

/**
 * 选项归一化。
 *
 * 支持的标号写法：`A) x` / `A. x` / `（A）x` / `(A) x` / `a、x` / `A：x`
 * 无标号则按传入序号补 A/B/C…
 *
 * ⚠ 已知取舍：若选项正文本身以「单个字母 + 顿号/句点」开头（如 `I. Introduction`），
 * 会被误判为标号。考试选项里这种情况罕见，且误判后 label 就是原文里的那个字母，
 * 仍可用 `--report` 看出来。真遇到可在源数据里写成 `(I) Introduction`。
 */
export function normalizeOption(
  raw: string,
  index = 0,
): { label: string; text: string } {
  const s = cleanText(toHalfWidth(stripInvisible(String(raw ?? ''))));

  // 括号写法：标号后不需要分隔符
  const bracketed = s.match(/^[（(]\s*([A-Za-z])\s*[）)]\s*([\s\S]*)$/);
  if (bracketed?.[1]) {
    return { label: bracketed[1].toUpperCase(), text: cleanText(bracketed[2] ?? '') };
  }

  // 字母 + 分隔符（要求分隔符后是空白或直接接正文，避免吃掉正常词首）
  const plain = s.match(/^([A-Za-z])\s*[).、．:：]\s*([\s\S]*)$/);
  if (plain?.[1]) {
    return { label: plain[1].toUpperCase(), text: cleanText(plain[2] ?? '') };
  }

  return { label: String.fromCharCode(65 + index), text: s };
}

/** 题号归一化：'26' / '２６' / '第26题' / '26.' → 26 */
export function normalizeQuestionNo(raw: unknown): number {
  const s = toHalfWidth(stripInvisible(String(raw ?? ''))).replace(/[^0-9]/g, '');
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`题号非法: ${JSON.stringify(raw)}`);
  }
  return n;
}

/** 说明标签归一化：'定位：' / ' 定位 ' → '定位' */
export function normalizeLabel(raw: string): string {
  return toHalfWidth(stripInvisible(String(raw ?? '')))
    .replace(/[.。:：\s]+$/g, '')
    .trim();
}

/* ---------- 表头识别 ---------- */

/**
 * 表头别名：让 Excel 里手写的列名都能对上。
 * 归一化后的键 = 小写、去全角、去空格/下划线/连字符。
 */
const HEADER_ALIASES: Record<string, string> = {
  paper: 'paper_id',
  paperid: 'paper_id',
  试卷: 'paper_id',
  套卷: 'paper_id',
  套卷号: 'paper_id',
  section: 'section',
  part: 'section',
  部分: 'section',
  no: 'no',
  number: 'no',
  qno: 'no',
  题号: 'no',
  stem: 'stem',
  题干: 'stem',
  题目: 'stem',
  stemzh: 'stem_zh',
  题干翻译: 'stem_zh',
  中文题干: 'stem_zh',
  题干中文: 'stem_zh',
  answer: 'answer',
  答案: 'answer',
  answertext: 'answer_text',
  答案文本: 'answer_text',
  questiontype: 'question_type',
  type: 'question_type',
  题型: 'question_type',
  anchor: 'anchor',
  锚点: 'anchor',
  paraoptions: 'para_options',
  paragraphs: 'para_options',
  段落: 'para_options',
  段落集合: 'para_options',
};

/** 归一化表头键 */
export function normalizeHeaderKey(raw: string): string {
  return toHalfWidth(stripInvisible(String(raw ?? '')))
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

/** 表头 → 标准字段名；不认识则返回原样（可能是 explain_* 或选项列） */
export function normalizeHeader(raw: string): string {
  const key = normalizeHeaderKey(raw);
  return HEADER_ALIASES[key] ?? key;
}

/** `explain_定位` / `解析：定位` / `说明-定位` → '定位'；不是说明列则返回 null */
export function explainLabelOf(header: string): string | null {
  const h = toHalfWidth(stripInvisible(String(header ?? ''))).trim();
  const m = h.match(/^(?:explain|analysis|解析|说明)\s*[_\-.:：]\s*(.+)$/i);
  if (m?.[1]) return normalizeLabel(m[1]);
  return null;
}

/** 选项列 → 选项字母；不是选项列则返回 null */
export function optionLabelOf(header: string): string | null {
  const h = toHalfWidth(stripInvisible(String(header ?? ''))).trim();
  // option_a / opt_a / 选项A / 选项_A
  const m = h.match(/^(?:option|opt|选项)\s*[_\-.:：]?\s*([A-Za-z])$/i);
  if (m?.[1]) return m[1].toUpperCase();
  // 裸字母列 A / B / C
  const bare = h.match(/^([A-Za-z])$/);
  if (bare?.[1]) return bare[1].toUpperCase();
  return null;
}

/** 中文选项列 → 选项字母；不是则返回 null */
export function optionZhLabelOf(header: string): string | null {
  const h = toHalfWidth(stripInvisible(String(header ?? ''))).trim();
  const m = h.match(
    /^(?:option|opt|选项)\s*[_\-.:：]?\s*([A-Za-z])\s*[_\-.:：]?\s*(?:zh|中文|译文)$/i,
  );
  if (m?.[1]) return m[1].toUpperCase();
  const m2 = h.match(/^([A-Za-z])\s*[_\-.:：]?\s*(?:zh|中文|译文)$/i);
  if (m2?.[1]) return m2[1].toUpperCase();
  return null;
}
