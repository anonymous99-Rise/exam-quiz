#!/usr/bin/env node
/**
 * 给 doc-extract.mjs 增加「按 Word 自动编号还原段落标签」的通道
 * ============================================================================
 * 背景（四级题库的第一个系统性卡点）：
 *   四级素材的**信息匹配段没有 A)–O) 文字标记** —— 段落编号是 Word 的自动编号列表，
 *   存在 word/document.xml 的 <w:numPr> 里，**不在文字层**，所以 stripXml 之后
 *   段落全都成了无标记的普通段落；连 36–45 的题号也是自动编号（decimal 列表）。
 *   于是 extractMatching 只切出 0 段。
 *
 * 实测这份素材的 numbering.xml：
 *   numId=2 → abstractNum 1 → numFmt=upperLetter, lvlText=%1)   ← 11 段 = A)–K)
 *   numId=3 → abstractNum 2 → numFmt=decimal,     lvlText=%1.   ← 10 段 = 36.–45.
 *
 * 本补丁做的事：
 *   1) docxToText 之外再加一个 docxListMeta(file)：解析出
 *      「段落文字 → { numId, fmt, start }」的映射
 *   2) extractMatching 在文字层找不到 A)–O) 时，回退到这条通道：
 *      取连续的 upperLetter 列表项当段落（按顺序还原 A、B、C…），
 *      取连续的 decimal 列表项当陈述句（按 start 还原题号）
 *
 * 为什么不用「按顺序硬编号」的偷懒做法：这份文档里听力选项也是列表（numId=1），
 * 而匹配段落与陈述句是两个不同的列表 —— 只有读元数据才能把两者精确分开，
 * 硬编号会把听力选项也算进段落里。
 */
import fs from 'node:fs';

const f = 'tools/doc-extract.mjs';
let s = fs.readFileSync(f, 'utf8');
let n = 0;
const apply = (from, to, label) => {
  if (!s.includes(from)) {
    console.log(`⚠ 未匹配: ${label}`);
    return;
  }
  s = s.split(from).join(to);
  n++;
  console.log(`✓ ${label}`);
};

/* ── 1) 新增：解析 docx 的自动编号元数据 ───────────────────────────────── */
apply(
  `function stripXml(xml) {`,
  `/**
 * 解析 docx 的**自动编号**元数据。
 *
 * 返回 Map<归一化段落文字, { numId, fmt, start }>。
 * 归一化＝去掉所有空白，因为文字层经过 stitchPartLines 拼接后空格不一定一致。
 *
 * 为什么要它：四级素材的信息匹配段用 Word 自动编号当 A)–O) 与 36.–45.，
 * 编号不在文字层里，只有读 document.xml 的 <w:numPr> + numbering.xml 才能还原。
 */
function docxListMeta(file) {
  const map = new Map();
  const unzip = [
    path.join(process.env.LOCALAPPDATA ?? '', 'hermes/git/usr/bin/unzip.exe'),
    'C:/Program Files/Git/usr/bin/unzip.exe',
  ].find((p) => fs.existsSync(p));
  if (!unzip) return map;

  let numbering = '';
  try {
    numbering = execFileSync(unzip, ['-p', file, 'word/numbering.xml'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return map; // 没有 numbering.xml 就不是自动编号文档
  }

  /* numId → abstractNumId → { fmt, start } */
  const fmtOf = new Map();
  for (const m of numbering.matchAll(/<w:num w:numId="(\\d+)"[^>]*>([\\s\\S]*?)<\\/w:num>/g)) {
    const numId = m[1];
    const abs = /<w:abstractNumId w:val="(\\d+)"/.exec(m[2])?.[1];
    if (abs == null) continue;
    const block = new RegExp(\`<w:abstractNum w:abstractNumId="\${abs}"[\\\\s\\\\S]*?</w:abstractNum>\`).exec(
      numbering,
    )?.[0];
    if (!block) continue;
    // 只看第一层（匹配段与陈述句都是单层列表）
    const lvl0 = /<w:lvl w:ilvl="0"[\\s\\S]*?<\\/w:lvl>/.exec(block)?.[0] ?? block;
    const fmt = /<w:numFmt w:val="([^"]+)"/.exec(lvl0)?.[1] ?? 'decimal';
    const start = Number(/<w:start w:val="(\\d+)"/.exec(lvl0)?.[1] ?? 1);
    fmtOf.set(numId, { fmt, start });
  }

  const xml = execFileSync(unzip, ['-p', file, 'word/document.xml'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  for (const p of xml.split('</w:p>')) {
    if (!/<w:numPr>/.test(p)) continue;
    const numId = /<w:numId w:val="(\\d+)"/.exec(p)?.[1];
    if (numId == null) continue;
    const meta = fmtOf.get(numId);
    if (!meta) continue;
    const text = p
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/\\s+/g, '')
      .trim();
    if (text) map.set(text, { numId, ...meta });
  }
  return map;
}

/** 自动编号列表的格式 → 第 idx 项（0 基）的展示标签 */
function listLabel(fmt, start, idx) {
  const v = start + idx;
  if (fmt === 'upperLetter') return String.fromCharCode(64 + v); // 1→A
  if (fmt === 'lowerLetter') return String.fromCharCode(96 + v);
  return String(v);
}

function stripXml(xml) {`,
  '新增 docxListMeta / listLabel',
);

/* ── 2) 生成候选时带上编号元数据 ─────────────────────────────────────── */
apply(
  `function extract(text, meta) {`,
  `function extract(text, meta, listMeta = new Map()) {`,
  'extract 接收 listMeta',
);

/* ── 3) extractMatching 增加编号兜底 ─────────────────────────────────── */
apply(
  `  if (blocks.length < 5) {
    warnings.push(\`匹配：只切出 \${blocks.length} 段，疑似失败\`);
  }`,
  `  /*
   * 文字层没有 A)–O) 标记时，回退到 Word 自动编号通道。
   * 四级素材全走这条路：段落是 upperLetter 列表（A)–K)），
   * 陈述句是 decimal 列表（36.–45.），两者列表 id 不同，可以精确分开。
   */
  if (blocks.length < 5 && MATCH_LIST_META.size) {
    const paraSeq = [];
    const stmtSeq = [];
    for (let k = sec.line + 1; k < sec.end; k++) {
      const raw = L[k].trim();
      if (!raw || /^Directions:/i.test(raw)) continue;
      const hit = MATCH_LIST_META.get(raw.replace(/\\s+/g, ''));
      if (!hit) {
        // Directions 与标题这类非列表行：若段落还未开始，当标题；否则续接上一段
        if (!paraSeq.length && !stmtSeq.length) continue;
        if (paraSeq.length && !stmtSeq.length) {
          const last = paraSeq[paraSeq.length - 1];
          if (last) last.text = cleanText(\`\${last.text} \${raw}\`);
        }
        continue;
      }
      if (hit.fmt === 'upperLetter') {
        if (stmtSeq.length) break; // 已经进入陈述句，段落结束
        paraSeq.push({ label: listLabel(hit.fmt, hit.start, paraSeq.length), text: raw });
      } else if (hit.fmt === 'decimal') {
        if (!paraSeq.length) continue;
        stmtSeq.push({ no: hit.start + stmtSeq.length, text: raw });
      }
    }
    if (paraSeq.length >= 5) {
      blocks.length = 0;
      for (const b of paraSeq) blocks.push({ label: b.label, text: b.text });
      warnings.push(
        \`匹配：文字层无 A)–O) 标记，已按 Word 自动编号还原 \${paraSeq.length} 段（\${paraSeq[0].label}–\${paraSeq[paraSeq.length - 1].label}）\`,
      );
    }
    // 陈述句优先用编号通道（题号也在列表里，文字层同样没有）
    if (stmtSeq.length >= 5) {
      for (const st of stmtSeq) {
        out.push({
          no: st.no,
          sectionId: 'matching',
          kind: 'paragraph-match',
          stem: cleanText(st.text),
          passageId: 'matching',
          paraOptions: blocks.map((b) => b.label),
          answer: null,
          analysis: [],
        });
      }
    }
  }

  if (blocks.length < 5) {
    warnings.push(\`匹配：只切出 \${blocks.length} 段，疑似失败\`);
  }`,
  'extractMatching 增加自动编号兜底',
);

/* ── 4) 模块级变量 + 调用点传入 ─────────────────────────────────────── */
apply(
  `const input = positional[0];`,
  `/** 当前文档的自动编号元数据（docx 才有；extractMatching 的兜底通道用） */
let MATCH_LIST_META = new Map();

const input = positional[0];`,
  '声明编号元数据变量',
);

apply(
  `  return extract(text, { examId: EXAM, paperId: PAPER, ...metaOut });`,
  `  // docx 才有自动编号：解析一次，供匹配段兜底使用
  if (/\\.docx?$/i.test(input)) MATCH_LIST_META = docxListMeta(input);
  return extract(text, { examId: EXAM, paperId: PAPER, ...metaOut });`,
  '调用点解析编号元数据',
);

fs.writeFileSync(f, s);
console.log(`共应用 ${n} 处`);
