#!/usr/bin/env node
/**
 * ans-extract.mjs — L3 解析抽取：答案解析 PDF → 答案 + 解析
 * ============================================================================
 * 真题册不含答案（实测「答案」出现 0 次），答案只在解析 PDF 里。
 * 本工具把解析 PDF 抽成**答案文件**，再由 bank-merge 与 L2 的候选合并成合法 Paper。
 *
 * ## 关键发现：答案其实有一条统一规律
 * 四种题型的版式各不相同，但**解析末尾都写「故答案为 X。」**：
 *
 *   听力  答案：C                       （独立行）
 *   完形  26.答案：K) puzzled …          （与题号同行，且带单词）
 *   匹配  故答案为 H。                    （嵌在详解段落末尾）
 *   阅读  46. 答案：C + 定位：… + 详解：…
 *
 * 所以先找 `答案为? X`，找不到再退回 `答案：X` 行 —— 一条规则覆盖四种版式。
 *
 * ## 两列排版
 * 信息匹配的原文与解析**并排两列**，pdftotext -layout 会把它们塞进同一行。
 * 解析内容（译文/定位/详解）在左列，用「3 个以上连续空格」切开取左半。
 *
 * ## 已知不可用的情况（见 docs/extraction-status.md §六）
 *   乱码（缺 ToUnicode）· 碎裂（行不成形）· 扫描件 → 必须走 OCR 支路
 * 本工具遇到这三类会明确报错，不会产出错误的答案。
 *
 * 用法：
 *   node tools/ans-extract.mjs <解析pdf> --paper 2018-06-1
 *   node tools/ans-extract.mjs <考期目录> --exam cet6
 *   node tools/ans-extract.mjs <解析pdf> --paper 2018-06-1 --report
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { cleanText, toHalfWidth } from '../src/lib/bank/normalize.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');

/* ---------- 参数 ---------- */
const VALUE_FLAGS = new Set(['--exam', '--paper', '--out', '--content', '--src']);
function parseArgv(list) {
  const positional = [];
  for (let i = 0; i < list.length; i++) {
    if (VALUE_FLAGS.has(list[i])) {
      i++;
      continue;
    }
    if (list[i].startsWith('--')) continue;
    positional.push(list[i]);
  }
  return positional;
}
const argv = process.argv.slice(2);
const positional = parseArgv(argv);
const getArg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const flags = (k) => argv.includes(k);

const input = positional[0];
const EXAM = getArg('--exam', 'cet6');
const PAPER = getArg('--paper');
const OUT = getArg('--out', path.join(PROJECT, '.candidates'));
const REPORT = flags('--report');

if (!input || !fs.existsSync(input)) {
  console.error('用法：node tools/ans-extract.mjs <解析pdf|考期目录> --exam cet6 [--paper 2018-06-1]');
  process.exit(2);
}

/* ==========================================================================
   一、文本化 + 质量门
   ========================================================================== */

const PDFTOTEXT = [
  path.join(
    process.env.LOCALAPPDATA ?? '',
    'Microsoft/WinGet/Packages/oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe/poppler-25.07.0/Library/bin/pdftotext.exe',
  ),
  'pdftotext',
].find((p) => p === 'pdftotext' || fs.existsSync(p));

function pdfToText(file) {
  return execFileSync(PDFTOTEXT, ['-layout', file, '-'], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    timeout: 300_000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/**
 * 质量门 —— 见 docs/extraction-status.md §六。
 * 三类不可用的 PDF 必须**明确拒绝**，而不是抽出一堆垃圾答案（那比抽不出来危险得多）。
 */
function qualityGate(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const chars = text.replace(/\s/g, '').length;
  if (chars < 800) return { ok: false, why: '文本层几乎为空（疑似扫描件），需 OCR 支路' };

  const meaningful = [...text].filter((c) => !/\s/.test(c));
  let good = 0;
  for (const c of meaningful) {
    const cp = c.codePointAt(0);
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0x4e00 && cp <= 0x9fff)) good++;
    else if (cp >= 0x3000 && cp <= 0x303f) good++;
    else if (cp >= 0xff00 && cp <= 0xffef) good++;
    else if ([0x2018, 0x2019, 0x201c, 0x201d, 0x2013, 0x2014, 0x2026].includes(cp)) good++;
  }
  const ratio = good / meaningful.length;
  if (ratio < 0.8) return { ok: false, why: `文本层乱码（正常字符占比 ${ratio.toFixed(2)}，缺 ToUnicode 映射），需 OCR 支路` };

  const frag = lines.filter((l) => l.trim().length <= 3).length / lines.length;
  if (frag > 0.5) return { ok: false, why: `排版碎裂（短行占比 ${frag.toFixed(2)}，单词边界丢失），需 OCR 支路` };

  return { ok: true, ratio, frag };
}

/* ==========================================================================
   二、切块与抽取
   ========================================================================== */

/** 解析内容的标记词（不同考期用词不同） */
const ANALYSIS_MARKERS = ['定位', '详解', '解析', '译文', '预测', '未听先知', '点睛', '干扰项', '词汇', '语法', '审题'];

/** 两列排版：用 3+ 连续空格切开，取左列 */
function leftColumn(line) {
  const parts = line.split(/[ \t]{3,}/);
  return parts[0].trim();
}

function extract(text) {
  const warnings = [];
  const rawLines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));

  // 1) 找题号行，切成块
  const blocks = [];
  let cur = null;
  for (const raw of rawLines) {
    const line = toHalfWidth(raw).trim();
    if (!line) {
      if (cur) cur.lines.push('');
      continue;
    }
    // 题号写法：`26.` `36.It is…` `46. 答案：` `1:` `7、`
    const m = line.match(/^(\d{1,2})\s*[.、:：]\s*(.*)$/);
    const no = m ? Number(m[1]) : null;
    const isQuestionStart =
      no != null &&
      no >= 1 &&
      no <= 55 &&
      // 必须严格递增或回退到新段落（避免把正文里的「2018.」当题号）；
      // 隐式块（听力小节刚开头）例外 —— 那一节的编号从哪儿续都可以。
      (!cur || cur.implicit || no === cur.no + 1 || no < cur.no);

    if (isQuestionStart) {
      if (process.env.ANS_DEBUG_BLOCKS && process.env.ANS_DEBUG_BLOCKS !== '0') {
        console.log(`[split] 起块 no=${no}（上一块 no=${cur?.no} implicit=${!!cur?.implicit}）:: ${line.slice(0, 66)}`);
      }
      if (cur && cur.lines.length) blocks.push(cur);
      cur = { no, lines: m[2] ? [m[2]] : [] };
      continue;
    }
    if (
      process.env.ANS_DEBUG_BLOCKS &&
      process.env.ANS_DEBUG_BLOCKS !== '0' &&
      /^\s*\d{1,2}\s*[.、:：]/.test(line)
    ) {
      console.log(`[split] ✗未起块 no=${no}（当前块 no=${cur?.no}）:: ${line.slice(0, 66)}`);
    }
    /*
     * 听力小节标题。两个作用：
     * ① 这一节的**第一题常常没有题号**（例：2015.12 的卷三，`Part ⅡListening
     *    Comprehension` 之后直接是 `M: … / W: … / Q: … / C.…故答案为 C.`），
     *    旧逻辑只能把上面的作文范文块当成第 1 题，于是第 1 题永远没有答案。
     *    这里用 no=0 起一个「隐式第 1 题」块（末尾映射回 1），
     *    若紧随其后真有 `1.` 标记，递增规则会让它正常另起块，两不相扰。
     * ② 标题之前的块**丢弃**（不 push）—— 那是作文范文里的 `1.` `2.` 句式拓展，
     *    不是题目解析；2015.12 卷三的「第 2 题答案错成 C」就是这么来的
     *    （范文块与真题块都得 scorer 分 3，稳定排序取了范文那块）。
     */
    if (/^(?:part\s*[ⅠⅡⅢIV1-9X]*\s*)?(?:listening\s*comprehension|听力理解)/i.test(line)) {
      cur = { no: 0, lines: [], implicit: true };
      continue;
    }
    /*
     * `听力原文：` / `Listening Script` 是**原文小节**标题，出现在听力小节内部
     * （2014.06 的排版正是「听力原文在前，逐题解析在后」）。
     * 它同样要重置编号（后面的解析可任意续号），但**必须先把当前块收下** ——
     * 否则刚起的题号块会被整块丢掉（2014.06 第 11 题整题消失就是这么来的）。
     */
    if (/^听力原文|^listening\s+(?:script|transcript)/i.test(line)) {
      if (cur && cur.lines.length) blocks.push(cur);
      cur = { no: 0, lines: [], implicit: true };
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  if (cur && cur.lines.length) blocks.push(cur);

  // 2) 按题号归并。
  /*
   * ⚠ 解析册里有**多个小节复用同一套编号**：Part IV 翻译的逐句解析也用 `1. 2. 3. …`，
   *   且它排在文档末尾，若「后写覆盖」就会把听力第 1–5 题顶掉（真踩过）。
   *   所以同一题号收集全部候选块，优先取「含答案标记」的那个。
   */
  const byNo = new Map();
  if (process.env.ANS_DEBUG_BLOCKS && process.env.ANS_DEBUG_BLOCKS !== '0') {
    console.log('\n[blocks] 共 ' + blocks.length + ' 块：' + blocks.map((b) => `${b.no}(${b.lines.length})`).join(' '));
  }
  for (const b of blocks) {
    // no=0 是「听力小节隐式第一题」，落到第 1 题
    const no = b.no === 0 ? 1 : b.no;
    const arr = byNo.get(no) ?? [];
    arr.push(b);
    byNo.set(no, arr);
  }

  const answers = {};
  for (const [no, candidates] of [...byNo.entries()].sort((a, b) => a[0] - b[0])) {
    // 选块：优先含「答案」字样，其次含解析标记，最后取第一个
    const score = (b) => {
      const j = b.lines.join('\n');
      let s = 1;
      if (/答案/.test(j)) s = 3;
      else if (/详解|解析|定位/.test(j)) s = 2;
      // 同分时优先「像一道题」的块（有对话/提问行），压过范文那种散文块
      if (/^\s*(?:\d{1,2}\s*[.、:：]\s*)?(?:M|W|Q)\s*[:：]/m.test(j)) s += 1;
      return s;
    };
    const b = [...candidates].sort((x, y) => score(y) - score(x))[0];

    const body = b.lines.filter((l) => l.trim()).map((l) => leftColumn(l));
    const joined = body.join('\n');
    // 未截断的整行文本，用于右列兜底（见下方 m7）
    const rawJoined = b.lines.filter((l) => l.trim()).join('\n');

    /*
     * 排查开关：`$env:ANS_DEBUG='1'`（或 ANS_DEBUG=1）时打印每题的候选块数与
     * 中选块全文，用来定位「为什么这题没抽到答案 / 题干为空」。
     * 只读、不影响抽取结果；平时不开。
     */
    if (process.env.ANS_DEBUG && process.env.ANS_DEBUG !== '0') {
      console.log(
        `\n----- 第 ${no} 题：候选 ${candidates.length} 块，中选 ${b.lines.length} 行（分 ${score(b)}）-----`,
      );
      console.log(candidates.map((c, i) => `  [${i}] 分${score(c)} / ${c.lines.length} 行 / ${c.lines[0]?.slice(0, 60) ?? ''}`).join('\n'));
      console.log(joined.slice(0, 2600));
    }

    /*
     * 答案规则。四种版式统一成一条：
     *   `答案：C`（听力/阅读）· `故答案为 H。`（匹配）· `26.答案：K) puzzled`（完形）
     * 所以模式要同时容忍「为」「：」的有无。
     * 2016.06 还多两种写法：
     *   `[参考答案]C`    方括号包住「参考答案」（第 1 套）
     *   `【正确答案】D`  方括号 + 「正确答案」（第 3 套）
     * 所以「左括号/右括号」两侧都要可选，且 `正确` 与 `参考` 都算前缀。
     * ⚠ 早期写成 `答案为?` 漏掉了 `答案：X`（冒号分隔）导致 1–5 题全丢。
     * ⚠ 只写 `[（(]?` 漏掉方括号，2016.06 第 2/3 套 0 答案。
     * 末尾的 (?![A-Za-z]) 防止把正文里的 "A." 之类误吞。
     */
    const ANSWER_RE =
      /(?:参考|正确)?答案\s*为?\s*[:：]?\s*[（(【\[]?\s*[】\]]?\s*([A-O])\s*[)）.、】\]]?(?![A-Za-z])/;
    let answer = null;
    const m1 = joined.match(ANSWER_RE);
    if (m1) answer = m1[1];

    /*
     * 回退：两列排版会把左列末尾截断。
     * 例：`…leverage…to improve educati` / `案为 D。` —— 「故答」被右列挤掉了。
     * 因此补一条「行尾只剩 `为 X。`」的规则。
     * 不写成 `答?案` 是因为 `方案 A` 这类正文会误命中；要求出现在行尾更安全。
     */
    if (!answer) {
      const m2 = joined.match(/(?:^|\n)[^\n]{0,8}为\s*[（(]?\s*([A-O])\s*[)）.、]?\s*[。.]?\s*(?=\n|$)/);
      if (m2) answer = m2[1];
    }

    /*
     * 回退 2：2014.06 版式 —— 正解不单独成行，而是写在句子里：
     *   `由此可推断出…故 C)是答案。`
     *   `A。【精析】女士在最后提到…`（阅读/完形）
     * 两种情况都要求「字母紧邻右括号/句号」，否则正文里随便一个 A) 都会误命中。
     */
    if (!answer) {
      const m3 = joined.match(/([A-O])\s*[)）]\s*是答案/);
      if (m3) answer = m3[1];
    }
    if (!answer) {
      const m4 = joined.match(/(?:^|\n|\s)([A-O])\s*[。.]\s*【/);
      if (m4) answer = m4[1];
    }

    /*
     * 回退 3：2015.12 版式 —— 正解跟在精析标记后面：
     *   `【精析】B)。男士说他在尝试打电话…`
     * 这种块里**没有「答案」二字**，上面所有规则都落空（该考期 1–25 题全丢）。
     */
    if (!answer) {
      const m5 = joined.match(/【精析】\s*[（(]?\s*([A-O])\s*[)）。、.]/);
      if (m5) answer = m5[1];
    }

    /*
     * 回退 4：选词填空（banked cloze，26–35）的结论句式：
     *   `N 中只有 G 项 growing 符合题意。`
     *   `只有 A 项 dependent 符合题意。`
     * 答案是**词库里的字母**（不是单词本身），正好与站点按字母判分的模型一致。
     * 用「只有 X 项」而非「X 项」是为了避开正文里列举备选项的句子。
     */
    if (!answer) {
      const m6 = joined.match(/只有\s*([A-O])\s*项\s*[，,]?\s*(?:答案)?(?:为|是)?/);
      if (m6) answer = m6[1];
    }

    /*
     * 回退 6：`X 项 … 符合题意` —— m6 只认「只有 X 项」，而实际写法更杂：
     *   `备选项 C 和 K 中，C 项 fast 符合题意。`（不是「只有」，字母与「项」之间没有别的字）
     *   `只有备选项 H 项 launch 符合题意。`（「只有」后面多了「备选项」三字，m6 也漏）
     * 抓「紧贴『项』字的那个字母」最稳，逗号/句号处截断避免跨句。
     */
    if (!answer) {
      const m7 = joined.match(/([A-O])\s*项\s*[^\s。，,]{0,14}\s*符合题意/);
      if (m7) answer = m7[1];
    }

    /*
     * 回退 7：选词填空的另外几种写法。都在**空白折叠后**的文本上匹配，
     * 因为 pdftotext 会把结论词从中间断行（`符合题\n意`）：
     *   `…搭配且符合题意的为选项 I 项 policy，意为…`（Q32）
     *   `只有备选项 O 项 treatments 符合题意`        （Q34，`只有` 与字母之间隔着「备选项」）
     *   `B) designed。此空为…`                      （Q33：全块只在**块首**给出字母）
     * 最后一条要求「字母 + 右括号 + 一个短英文词 + 中文句号」——
     * 选项行 `A) She had a job interview to attend.`（结尾是 ASCII 句点）因此不会误命中。
     */
    if (!answer) {
      const flat = joined.replace(/\s+/g, ' ');
      const m8 =
        flat.match(/为选项\s*([A-O])\s*项/) ??
        flat.match(/只有[^。]{0,12}?([A-O])\s*项/) ??
        flat.match(/([A-O])\s*项[^。]{0,16}?符合题意/) ??
        flat.match(/^\(?([A-O])\s*[)）.、]\s*[A-Za-z][A-Za-z'’\-]{1,14}。/);
      if (m8) answer = m8[1];
    }

    /*
     * 回退 5：右列兜底。
     * 两列排版时结论句常被挤到右列，而 `leftColumn()` 只保留左列，
     * 于是下面这种块会漏答案（2016.06 第 3 套的选择填空 28/29/30/32–35 全踩）：
     *   `C) fast。…备选项 C 和 K   |   中只有 C 项 fast 符合题意。`
     * 用同一批规则在「整行未截断」的文本上再跑一遍。
     * 只挑**自带答案语义**的几条规则，不放宽松的 m2/m4 进来（避免把右列选项当答案）。
     */
    if (!answer && rawJoined !== joined) {
      const mFull =
        rawJoined.match(ANSWER_RE) ??
        rawJoined.match(/([A-O])\s*[)）]\s*是答案/) ??
        rawJoined.match(/【精析】\s*[（(]?\s*([A-O])\s*[)）。、.]/) ??
        rawJoined.match(/只有\s*([A-O])\s*项/) ??
        rawJoined.match(/([A-O])\s*项\s*[^\s。，,]{0,14}\s*符合题意/) ??
        rawJoined.replace(/\s+/g, ' ').match(/为选项\s*([A-O])\s*项/) ??
        rawJoined.replace(/\s+/g, ' ').match(/只有[^。]{0,12}?([A-O])\s*项/);
      if (mFull) answer = mFull[1];
    }

    // 解析：带标记词的行 + 其后未带标记的续行
    const analysis = [];
    let bucket = null;
    for (const l of body) {
      const mk = ANALYSIS_MARKERS.find((k) => new RegExp(`^${k}\\s*[:：]`).test(l) || l === k || l === `${k}：`);
      if (mk) {
        bucket = { label: mk, text: l.replace(new RegExp(`^${mk}\\s*[:：]\\s*`), '') };
        analysis.push(bucket);
        continue;
      }
      if (bucket) {
        // 题号行/方向词会另起；其余算续行
        if (/^\d{1,2}\s*[.、:：]/.test(l)) {
          bucket = null;
          continue;
        }
        bucket.text = cleanText(`${bucket.text} ${l}`);
      }
    }

    /*
     * 听力题干：优先取真正的**提问句**（`Q: What does the woman mean?`），
     * 它才是题干；没有提问行时退回第一段英文（对话/独白，至少能提示场景）。
     * 只对 1–25 做 —— 真题册里听力**只有选项没有题干**，必须从解析册补；
     * 其余题型的题干来自真题册（L2），这里抽出来只会带进「译文/定位」之类的噪音。
     */
    let stem = null;
    if (no >= 1 && no <= 25) {
      const q = body.find((l) => /^Q\s*[:：]\s*\S/.test(l.trim()));
      const first = body.find(
        (l) => l.trim() && !/^答案|^详解|^解析|^定位|^译文|^预测|^未听先知|^点睛/.test(l.trim()),
      );
      const src = q ?? first;
      if (src && /[A-Za-z]{3}/.test(src) && src.length > 12) {
        stem = cleanText(src.replace(/^(?:Q|M|W)\s*[:：]\s*/, ''));
      }
    }

    if (process.env.ANS_DEBUG && process.env.ANS_DEBUG !== '0') {
      console.log(`==> 第 ${no} 题 抽取结果：answer=${answer ?? '(空)'} stem=${JSON.stringify(stem)}`);
    }

    answers[no] = {
      answer,
      stem,
      analysis: analysis.filter((a) => a.text.trim()),
      _raw: joined.slice(0, 400),
    };
  }

  /*
   * 紧凑答案总表（`答案速查`）—— **最权威的答案来源**，优先于逐题详解。
   *
   * 实测四级 2016.06 的解析册开头就是：
   *   `1. C  2. A  3. B  4. A  5. D  6. B … 55. B`
   * 一行 5 个答案、共 11 行。旧逻辑按「一行一个题号」切块，
   * 于是整张表只认到 `1. C`，其余 54 个答案全丢（该考期 0 答案）。
   *
   * 识别方式：在全文中找连续的 `题号 字母` 对，要求题号覆盖 ≥20 个不同题号；
   * 命中就把它当权威答案，逐题详解只用来补解析与题干。
   */
  const quickTable = {};
  {
    /*
     * 先抹掉答案标记再配对，两种速查表写法就归一成同一种：
     *   `1. C  2. A  3. B`          （2016.06 第 1 套）
     *   `1.【答案】B  2.【答案】D`   （2016.06 第 2 套）
     * 不抹标记的话第二种一个都配不上（题号与字母之间隔着「【答案】」）。
     */
    const flat = text
      .replace(/\s+/g, ' ')
      .replace(/[【\[]\s*(?:参考|正确)?答案\s*[】\]]/g, ' ');
    /*
     * 末尾的 (?![A-Za-z)）]) 是**排除选项行**的关键：
     *   真速查表 `1. C  2. A`     → 字母后面是空格/行尾
     *   假命中   `1. A) See a…`    → 字母后面紧跟右括号，是题干选项不是答案
     * 2014.06 的解析册通篇是 `N. A) 选项文字`，不排除的话会把 1–28 题
     * 全部伪造成 A（且分布 100% 是 A），比「抽不到」更危险。
     */
    const pairs = [...flat.matchAll(/(\d{1,2})\s*[.、]?\s*([A-O])\b(?![A-Za-z)）])/g)];
    const seq = [];
    for (const p of pairs) {
      const n = Number(p[1]);
      if (n < 1 || n > 55) continue;
      // 只接受严格递增的序列（避免把正文里的「2016 A」之类当答案）
      if (seq.length && n !== seq[seq.length - 1].no + 1) {
        if (n <= seq[seq.length - 1].no) continue;
      }
      if (quickTable[n] === undefined || seq.length === 0) {
        quickTable[n] = p[2];
        seq.push({ no: n, ans: p[2] });
      }
    }
  }
  const quickCount = Object.keys(quickTable).length;

  /* ---------- 自检 ---------- */
  const nos = Object.keys(answers).map(Number).sort((a, b) => a - b);
  /*
   * 用总表补全：逐题详解里抽到的答案优先保留（它带上下文），
   * 总表补上详解没抽到的题号（答案以总表为准 —— 那是官方速查表）。
   */
  if (quickCount >= 20) {
    let filled = 0;
    for (const [no, ans] of Object.entries(quickTable)) {
      const n = Number(no);
      if (!answers[n]) {
        answers[n] = { no: n, answer: ans, analysis: [], _raw: '（答案来自解析册的答案速查表）' };
        filled++;
      } else if (answers[n].answer !== ans) {
        // 冲突：以总表为准，但记一条警告（便于人工抽查）
        warnings.push(`第 ${n} 题：详解写 ${answers[n].answer}，速查表写 ${ans}（采用速查表）`);
        answers[n].answer = ans;
      }
    }
    warnings.push(
      `答案速查表：识别到 ${quickCount} 个答案${filled ? `，补全 ${filled} 题` : ''}`,
    );
  }

  const nosAll = Object.keys(answers).map(Number).sort((a, b) => a - b);
  const withAnswer = nosAll.filter((n) => answers[n].answer);
  const missing = nosAll.filter((n) => !answers[n].answer);
  if (missing.length) {
    warnings.push(`${missing.length} 题没抽到答案：${missing.slice(0, 20).join(',')}`);
  }
  // 答案分布异常（同一字母占比过高）通常意味着规则抓错位置
  const dist = {};
  for (const n of withAnswer) dist[answers[n].answer] = (dist[answers[n].answer] ?? 0) + 1;
  const top = Object.entries(dist).sort((a, b) => b[1] - a[1])[0];
  if (top && withAnswer.length >= 20 && top[1] / withAnswer.length > 0.5) {
    warnings.push(`答案分布异常：${top[0]} 占 ${Math.round((top[1] / withAnswer.length) * 100)}%，疑似规则抓错`);
  }
  void nos;

  return { answers, warnings, blocks: blocks.length, withAnswer: withAnswer.length };
}

/* ==========================================================================
   三、主流程
   ========================================================================== */

function inferPaperId(file) {
  const dir = path.dirname(file);
  const base = path.basename(file);
  const dm = dir.match(/CET6[._](\d{4})[._](\d{2})/);
  if (!dm) return null;
  const ym = `${dm[1]}-${dm[2]}`;
  let set = 1;
  let m = base.match(/第\s*([1-3])\s*套/);
  if (m) set = Number(m[1]);
  else if ((m = base.match(/[（(]([一二三])[)）]/))) set = { 一: 1, 二: 2, 三: 3 }[m[1]];
  else if ((m = base.match(/[-_](\d)(?=\.|$)/))) set = Number(m[1]);
  return `${ym}-${set}`;
}

const files = [];
if (fs.statSync(input).isDirectory()) {
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (/\.pdf$/i.test(e.name) && /解析|答案/.test(e.name)) files.push(abs);
    }
  };
  walk(input);
} else {
  files.push(input);
}

fs.mkdirSync(OUT, { recursive: true });
let ok = 0;
let skipped = 0;

for (const file of files) {
  const paperId = PAPER ?? inferPaperId(file);
  if (!paperId) {
    console.log(`✗ ${path.basename(file)}：无法推断套卷 id`);
    skipped++;
    continue;
  }

  let text;
  try {
    text = pdfToText(file);
  } catch (e) {
    console.log(`✗ ${paperId}：文本化失败 ${e.message}`);
    skipped++;
    continue;
  }

  const gate = qualityGate(text);
  if (!gate.ok) {
    console.log(`⊘ ${paperId.padEnd(12)} 跳过：${gate.why}`);
    skipped++;
    continue;
  }

  const res = extract(text);

  /*
   * 抽取结果自检不过就**不写盘** —— 错误答案比没答案危险得多：
   * 备考的人会照着错答案记住错的。
   */
  const hardFail = res.withAnswer < 20 || res.warnings.some((w) => w.includes('抓错'));
  if (hardFail) {
    console.log(`✗ ${paperId.padEnd(12)} 自检未过（抽到答案 ${res.withAnswer} 题），不写盘`);
    for (const w of res.warnings) console.log(`     ⚠ ${w}`);
    skipped++;
    continue;
  }

  const out = {
    _kind: 'answers',
    _examId: EXAM,
    _paperId: paperId,
    _source: path.relative(PROJECT, file).replace(/\\/g, '/'),
    _extractedAt: new Date().toISOString(),
    _quality: { meaningfulRatio: Number(gate.ratio.toFixed(3)), frag: Number(gate.frag.toFixed(3)) },
    _warnings: res.warnings,
    _stats: { blocks: res.blocks, withAnswer: res.withAnswer },
    answers: res.answers,
  };

  fs.writeFileSync(path.join(OUT, `${paperId}.ans.json`), JSON.stringify(out, null, 2) + '\n');
  console.log(
    `✓ ${paperId.padEnd(12)} 块 ${String(res.blocks).padStart(3)}  答案 ${String(res.withAnswer).padStart(3)}  ` +
      `质量 ${gate.ratio.toFixed(2)}/${gate.frag.toFixed(2)}`,
  );
  if (REPORT && res.warnings.length) for (const w of res.warnings) console.log(`     ⚠ ${w}`);
  ok++;
}

console.log(`\n完成：${ok} 套成功，${skipped} 套跳过 → ${path.relative(PROJECT, OUT)}/`);
console.log('下一步：node tools/bank-merge.mjs <paperId> --exam cet6   （候选 + 答案 → 合法 Paper）');
process.exit(0);
