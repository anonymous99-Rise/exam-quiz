/**
 * 题库 schema —— 全站唯一真源
 * ============================================================================
 * 设计原则（见 docs/DESIGN.md §4）：
 *
 *  1. 题目是**判别联合**（discriminated union），不是靠 `part` 字符串决定渲染。
 *  2. 解析是**有序的 {label, text}[]**，渲染层不认识任何 label ——
 *     于是新题型可以自定义解析维度，加题不用改渲染代码。
 *  3. `passages` 同时保存 `raw`（保真原文）与 `blocks`（切好的段落，UI 直接用）。
 *  4. 试卷结构（有哪些 section、每个 section 覆盖哪些题号）由 ExamConfig 声明，
 *     **不硬编码** —— 新增考试 = 新增一个 content/<exam>/ 目录。
 *  5. 每个由「文档抽取」产生的题目带 `provenance`，OCR 来源必须可追溯、可批量重抽。
 *
 * 所有读写题库的代码只能从本文件的 Zod 类型推导，禁止手写重复 interface。
 */
import { z } from 'zod';

/* ==========================================================================
   原子类型
   ========================================================================== */

/** 选项字母 A–Z */
export const zLetter = z
  .string()
  .regex(/^[A-Z]$/, '选项字母必须是大写单字母 A–Z');

/** 答案：单字母，或多选（如 "AB"），或文字答案（如匹配题的段落号） */
export const zAnswer = z
  .string()
  .min(1)
  .regex(/^[A-Z]{1,4}$/, '答案必须是大写字母（多选连写，如 AB）');

/** 题号：正整数 */
export const zQuestionNo = z.number().int().positive();

/** 来源与可追溯性 */
export const zProvenance = z.object({
  /** legacy=旧站迁移 · doc=Word 文档 · pdf-text=文本版 PDF · pdf-ocr=扫描件 OCR · manual=人工录入 */
  source: z.enum(['legacy', 'doc', 'pdf-text', 'pdf-ocr', 'manual']),
  /** 是否经 OCR 产生（OCR 结果必须有此标记，便于日后批量重抽） */
  ocr: z.boolean().default(false),
  /** 源文件相对路径（相对 .sources 或旧站 data/） */
  file: z.string().optional(),
  /** 抽取/校对备注 */
  note: z.string().optional(),
});
export type Provenance = z.infer<typeof zProvenance>;

/* ==========================================================================
   解析：有序数组
   --------------------------------------------------------------------------
   旧数据有三套互不相同的解析命名：
     听力/阅读  定位 · 信号 · 替换 · 排除（阅读另有 判型 · 拆句 · 选项）
     匹配       定位 · 改写 · 辨邻
     选词填空   词性槽 · 依据 · 竞争词 · 易错
     翻译逐句   主干 · 降级 · 语法 · 译文
   统一为有序数组后，上述差异全部下沉到数据里。
   ========================================================================== */

export const zAnalysisEntry = z.object({
  label: z.string().min(1),
  text: z.string(),
});
export type AnalysisEntry = z.infer<typeof zAnalysisEntry>;

export const zAnalysis = z.array(zAnalysisEntry);
export type Analysis = z.infer<typeof zAnalysis>;

/**
 * 解析维度（`analysis[].label`）的**权威顺序**。
 *
 * 为什么必须是常量而不是各工具各写一份：导出格式是「一题一行、一标签一列」，
 * 列序由标签决定，所以**行内顺序也必须由标签决定**，否则导出→导回必然重排
 * （bank-roundtrip 会挂）。迁移、合并、导出、测试四处此前各维护一份同样的表，
 * 加一个新维度要改四遍，漏改就会在导出时**静默丢标签**。
 *
 * 前 14 个是旧站既有维度；后面 4 个来自 2013–2019 解析册（那套材料给的是
 * 整段「详解」，而不是旧站的技巧拆解，另附听力特有的 点睛 / 未听先知）。
 * **新增维度加到这里即可**，四个使用方都按本表排序/出列。
 */
export const LABEL_ORDER = [
  '判型', '拆句',
  '定位', '信号', '替换',
  '锚点', '改写', '辨邻',
  '词性槽', '依据', '竞争词',
  '排除', '选项', '易错',
  '点睛', '未听先知', '详解', '译文',
];

/** 解析标签的排序秩；表外标签排在最后（调用方需用稳定排序保持其相对顺序） */
export const labelRank = (label: string): number => {
  const i = LABEL_ORDER.indexOf(label);
  return i < 0 ? LABEL_ORDER.length : i;
};

/* ==========================================================================
   选项
   ========================================================================== */

export const zOption = z.object({
  label: zLetter,
  text: z.string().min(1),
  textZh: z.string().optional(),
});
export type Option = z.infer<typeof zOption>;

/* ==========================================================================
   题目：判别联合
   ========================================================================== */

const zQuestionBase = z.object({
  no: zQuestionNo,
  /** 归属 section（由 ExamConfig.sections[].id 定义） */
  sectionId: z.string().min(1),
  /**
   * 归属阅读原文的 key（对应 Paper.passages 的键）：
   * 'cloze' | 'matching' | 'reading-1' | 'reading-2'
   * 听力题无原文，此字段缺省。旧站的 `pref` / `passageNo` 就表达这个含义。
   */
  passageId: z.string().optional(),
  /** 英文题干 */
  stem: z.string().min(1),
  /** 中文翻译（旧站部分题型缺此字段） */
  stemZh: z.string().optional(),
  /** 标准答案 */
  answer: zAnswer,
  /** 答案文本（如选词填空的单词、匹配题的「G 段」） */
  answerText: z.string().optional(),
  /** 题型标签：细节题 / 推断题 / 主旨题 …（旧站 cloze/matching 缺此字段） */
  questionType: z.string().optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  tags: z.array(z.string()).optional(),
  analysis: zAnalysis.default([]),
  provenance: zProvenance.optional(),
});

/** 四选一 / 多选：听力、仔细阅读、完形填空 */
export const zSingleChoice = zQuestionBase.extend({
  kind: z.literal('single-choice'),
  options: z.array(zOption).min(2),
});

/** 选词填空（15 选 10）：词库 + 空位 */
export const zWordBank = zQuestionBase.extend({
  kind: z.literal('word-bank'),
  /** 词库字母 → 单词，如 { A: 'aesthetic', … , O: 'weeding' } */
  wordBank: z.record(zLetter, z.string().min(1)),
  /** 词库的展示顺序（A–O） */
  options: z.array(zOption),
});

/** 长篇阅读 · 信息匹配：题干 → 段落号（A–M） */
export const zParagraphMatch = zQuestionBase.extend({
  kind: z.literal('paragraph-match'),
  /** 可选段落集合，如 ['A','B',…,'M'] */
  paraOptions: z.array(zLetter).min(2),
  /** 定位锚点（中文短语，旧站 anchor 字段） */
  anchor: z.string().optional(),
});

export const zQuestion = z.discriminatedUnion('kind', [
  zSingleChoice,
  zWordBank,
  zParagraphMatch,
]);
export type Question = z.infer<typeof zQuestion>;
export type QuestionKind = Question['kind'];

/* ==========================================================================
   阅读原文
   ========================================================================== */

export const zPassageBlock = z.object({
  /** 段落标号：'A'（匹配题）或 'P1'（仔细阅读）；无标号则缺省 */
  label: z.string().optional(),
  text: z.string().min(1),
});
export type PassageBlock = z.infer<typeof zPassageBlock>;

export const zPassage = z.object({
  /** 'cloze' | 'matching' | 'reading-1' | 'reading-2' */
  id: z.string().min(1),
  /** 原文逐字保真 */
  raw: z.string(),
  /** 切成段落，UI 直接渲染（匹配题需要按段落高亮，必须切开） */
  blocks: z.array(zPassageBlock),
});
export type Passage = z.infer<typeof zPassage>;

/* ==========================================================================
   主观题
   ========================================================================== */

export const zWriting = z.object({
  directions: z.string(),
  /**
   * 参考范文。
   * 可选：真题册只印题目要求，范文在解析册里；2013–2019 那批解析册的写作范
   * 文尚未接入 L3，所以允许「只有题目要求」的状态，渲染层降级不显示范文区。
   */
  model: z.string().optional(),
  /** 范文整篇中译 */
  modelZh: z.string().optional(),
  /** 逐段拆解（旧站资产；新抽套卷可能没有，默认空数组） */
  outline: z
    .array(
      z.object({
        no: z.number().int().positive(),
        text: z.string(),
      }),
    )
    .default([]),
});
export type Writing = z.infer<typeof zWriting>;

export const zTranslation = z.object({
  directions: z.string(),
  /** 中文原文（真题册里有） */
  source: z.string(),
  /**
   * 参考译文（**只在解析册里有**）。
   * 真题册只给 directions + source，参考译文与逐句解析要靠 L3 补；
   * 在补上之前这两个字段缺省是正常的，UI 必须能优雅降级。
   */
  reference: z.string().optional(),
  /** 逐句解析；每句是一个 Analysis（旧站 key 为 trunk/downgrade/grammar/target） */
  sentences: z.array(zAnalysis).default([]),
});
export type Translation = z.infer<typeof zTranslation>;

export const zSubjective = z.object({
  writing: zWriting.optional(),
  translation: zTranslation.optional(),
});
export type Subjective = z.infer<typeof zSubjective>;

/* ==========================================================================
   资产（原卷 PDF / 解析 PDF / 听力）
   ========================================================================== */

export const zFileAsset = z.object({
  url: z.string(),
  /** 字节数（上传对象存储后回填，便于展示与校验） */
  size: z.number().int().nonnegative().optional(),
  sha256: z.string().optional(),
});

export const zAudioPiece = z.object({
  label: z.string(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
});
export type AudioPiece = z.infer<typeof zAudioPiece>;

export const zAudioAsset = z.object({
  /** hls = 第三方 m3u8 流；mp3 = 自托管音频文件 */
  kind: z.enum(['hls', 'mp3']),
  url: z.string(),
  /** 分段定位（Section A/B/C 各篇），可选 */
  pieces: z.array(zAudioPiece).optional(),
  durationSec: z.number().positive().optional(),
  /** 音源不可用时的兜底来源页 */
  fallbackUrl: z.string().optional(),
  /** 字节数（mp3 自托管时回填） */
  size: z.number().int().nonnegative().optional(),
  /** 音源出处，如 'CET6-Resources'；第三方 HLS 时缺省 */
  source: z.string().optional(),
  /** 源文件相对路径（素材库内的位置，便于追溯与重传） */
  localPath: z.string().optional(),
  /** 本套与另一套共用同一份音频（素材库有明确注记时才填） */
  sharedWith: z.string().optional(),
  /** 共用原因 */
  note: z.string().optional(),
});
export type AudioAsset = z.infer<typeof zAudioAsset>;

export const zPaperAssets = z.object({
  paperPdf: zFileAsset.optional(),
  answerPdf: zFileAsset.optional(),
  audio: zAudioAsset.optional(),
});
export type PaperAssets = z.infer<typeof zPaperAssets>;

/* ==========================================================================
   试卷
   ========================================================================== */

export const zPaper = z.object({
  /** '2025-06-1' */
  id: z.string().regex(/^\d{4}-\d{2}-\d+$/, 'id 形如 2025-06-1'),
  examId: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  /** 考期名，如 '2025下半年' */
  session: z.string().min(1),
  /** 第几套 */
  setNo: z.number().int().positive(),
  /** 展示名，如 '2025年6月' */
  label: z.string().min(1),
  questions: z.array(zQuestion),
  passages: z.record(z.string(), zPassage).default({}),
  subjective: zSubjective.optional(),
  assets: zPaperAssets.optional(),
  /**
   * 数据完整性标记，UI 如实呈现，不假装完整：
   *  - incomplete        空卷 / 题量为 0
   *  - no-audio          无听力音频
   *  - missing-nos       题号跳号
   *  - no-analysis       存在无解析的题
   *  - passage-truncated 阅读原文缺尾段（旧站匹配题原文系统性截断，答案越界即命中）
   */
  flags: z
    .array(z.enum(['incomplete', 'no-audio', 'missing-nos', 'no-analysis', 'passage-truncated']))
    .default([]),
});
export type Paper = z.infer<typeof zPaper>;

/* ==========================================================================
   考试定义（扩展性的落点）
   --------------------------------------------------------------------------
   新增考试 = 新增 content/<exam>/exam.json + papers/*.json，**不改代码**。
   只有出现全新题型时才需要加一个 renderer。
   ========================================================================== */

export const zSection = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['single-choice', 'word-bank', 'paragraph-match', 'essay', 'translation']),
  /** 本 section 覆盖的题号（真实试卷存在跳号，必须显式列出） */
  questionNos: z.array(zQuestionNo),
  /** 分值，用于折算分 */
  score: z.number().nonnegative().optional(),
  renderer: z.enum(['audio-flow', 'passage-split', 'flat-list', 'subjective']),
  media: z.enum(['hls-audio', 'mp3', 'none']).default('none'),
  /** 该 section 的解析维度顺序（仅用于导入时归一化与 UI 提示，渲染不依赖） */
  analysisLabels: z.array(z.string()).optional(),
});
export type Section = z.infer<typeof zSection>;

export const zSessionMeta = z.object({
  /** '2025下半年' */
  name: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
  half: z.enum(['上半年', '下半年']),
  months: z.array(z.number().int().min(1).max(12)),
});
export type SessionMeta = z.infer<typeof zSessionMeta>;

export const zExamConfig = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  shortName: z.string().min(1),
  description: z.string().optional(),
  /** 整卷模考的官方时长（分钟），用于计时器与交卷倒计时 */
  examDurationMin: z.number().int().positive().optional(),
  /** 客观题总分（用于折算分展示），通常 710 分制下的客观题部分 */
  objectiveScore: z.number().positive().optional(),
  sections: z.array(zSection).min(1),
  sessions: z.array(zSessionMeta),
});
export type ExamConfig = z.infer<typeof zExamConfig>;

/* ==========================================================================
   轻量索引
   --------------------------------------------------------------------------
   列表页（年份 / 考期 / 套卷列表）不该为了显示套卷名去读 8.3MB 的全文 JSON。
   由 tools/bank-index.mjs 生成 content/<exam>/index.json。
   ========================================================================== */

export const zPaperIndexEntry = z.object({
  id: z.string(),
  year: z.number().int(),
  month: z.number().int(),
  session: z.string(),
  setNo: z.number().int().positive(),
  label: z.string(),
  questionCount: z.number().int().nonnegative(),
  /** 本套实际收录的题号（真实试卷有跳号，不能靠 1..count 推） */
  nos: z.array(z.number().int().positive()),
  /**
   * 每个 section 的题号。
   * 错题本要按 qid 定位到「哪一部分的第几题」，有了它就不必为了跳转去读 250KB 的全文。
   * 只多几 KB，换掉一次网络往返。
   */
  sectionNos: z.record(z.string(), z.array(z.number().int().positive())),
  /** 每个 section 的题量，如 { listening: 25, cloze: 10, … } */
  sectionCounts: z.record(z.string(), z.number().int().nonnegative()),
  flags: z.array(z.string()),
  hasSubjective: z.boolean(),
  hasAudio: z.boolean(),
});
export type PaperIndexEntry = z.infer<typeof zPaperIndexEntry>;

export const zBankIndex = z.object({
  examId: z.string(),
  generatedAt: z.string(),
  papers: z.array(zPaperIndexEntry),
});
export type BankIndex = z.infer<typeof zBankIndex>;

/** 从完整试卷派生索引条目（bank-index.mjs 与导入器共用，避免两处口径不一致） */
export function toIndexEntry(paper: Paper, hasAudio: boolean): PaperIndexEntry {
  const sectionCounts: Record<string, number> = {};
  const sectionNos: Record<string, number[]> = {};
  for (const q of paper.questions) {
    sectionCounts[q.sectionId] = (sectionCounts[q.sectionId] ?? 0) + 1;
    (sectionNos[q.sectionId] ??= []).push(q.no);
  }
  for (const arr of Object.values(sectionNos)) arr.sort((a, b) => a - b);

  return {
    id: paper.id,
    year: paper.year,
    month: paper.month,
    session: paper.session,
    setNo: paper.setNo,
    label: paper.label,
    questionCount: paper.questions.length,
    nos: paper.questions.map((q) => q.no).sort((a, b) => a - b),
    sectionNos,
    sectionCounts,
    flags: paper.flags,
    hasSubjective: Boolean(paper.subjective),
    hasAudio,
  };
}

/* ==========================================================================
   校验辅助
   ========================================================================== */

/** 安全解析，失败时返回可读的问题清单（导入器与校验器共用） */
export function parseOrIssues<T extends z.ZodType>(
  schema: T,
  value: unknown,
): { ok: true; data: z.infer<T> } | { ok: false; issues: string[] } {
  const r = schema.safeParse(value);
  if (r.success) return { ok: true, data: r.data };
  return {
    ok: false,
    issues: r.error.issues.map((i) => {
      const at = i.path.length ? i.path.join('.') : '(root)';
      return `${at}: ${i.message}`;
    }),
  };
}

/** 试卷自检：题号连续性、答案合法性、passages 引用完整性 —— 供 tools/bank-validate.mjs 调用 */
export function inspectPaper(paper: Paper): string[] {
  const warn: string[] = [];
  const nos = paper.questions.map((q) => q.no);
  const dup = nos.filter((n, i) => nos.indexOf(n) !== i);
  if (dup.length) warn.push(`题号重复: ${[...new Set(dup)].join(', ')}`);

  const sorted = [...nos].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur !== prev + 1) warn.push(`题号跳号: ${prev} → ${cur}（缺 ${cur - prev - 1} 题）`);
  }

  const noAnalysis = paper.questions.filter((q) => q.analysis.length === 0);
  if (noAnalysis.length) warn.push(`无解析: ${noAnalysis.length} 题（${noAnalysis.slice(0, 8).map((q) => q.no).join(', ')}…）`);

  for (const q of paper.questions) {
    if (q.kind === 'single-choice') {
      const labels = new Set(q.options.map((o) => o.label));
      const ans = q.answer.split('');
      for (const a of ans) {
        if (!labels.has(a)) warn.push(`第 ${q.no} 题答案 ${a} 不在选项集合 ${[...labels].join('/')} 内`);
      }
    }
    if (q.kind === 'paragraph-match') {
      for (const a of q.answer.split('')) {
        if (!q.paraOptions.includes(a)) {
          warn.push(
            `第 ${q.no} 题答案 ${a} 不在段落集合内（多半是原文缺尾段 → flags 应含 passage-truncated）`,
          );
        }
      }
    }
    if (q.kind === 'word-bank' && !q.wordBank[q.answer]) {
      warn.push(`第 ${q.no} 题答案 ${q.answer} 不在词库内`);
    }
  }

  // passages 引用完整性：section 声明用到的 passage 必须存在
  const used = new Set<string>();
  for (const q of paper.questions) {
    if (q.kind === 'paragraph-match') used.add('matching');
    if (q.kind === 'word-bank') used.add('cloze');
  }
  for (const id of used) {
    if (!paper.passages[id]) warn.push(`缺少 passages.${id}（有对应题型但无原文）`);
  }

  return warn;
}
