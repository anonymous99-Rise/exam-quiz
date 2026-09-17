#!/usr/bin/env node
/**
 * 一次性修补：5 道选词填空的题干被抽取器截断，且**原文里的空位标记也被中文注音吞掉**，
 * 无法自动定位（tools/fix-cloze-stems.mjs 只能修原文里还留着 `(N)______` 的那两道）。
 *
 * 这 5 道的重建依据（逐步核对过，没有编造词）：
 *   1) 原文片段本身（中文注音处就是空位被吞的位置）
 *   2) 该题的答案词与答案词性
 *   3) 该题解析里写明的语法依据（如「介词 without 后接名词」）
 *
 * 例：2022-12-1#27 原文 = `…a schizophrenic(精神分裂症患者) without to her medications…`
 *     答案 = access，解析 = 「介词 without 后接名词」
 *     → 空位在 without 之后：`…a schizophrenic without __(27)__ to her medications.`
 *
 * 只改这 5 条的 stem，不碰原文、答案与解析。
 */
import fs from 'node:fs';

const FIXES = [
  {
    paper: '2020-12-2',
    no: 29,
    from: 'The pandemic(',
    to: 'The pandemic will take lives, economies and __(29)__ destroy routines, but it will pass.',
    why: '答案 strangle；解析「take … , ___ … and destroy 三并列谓语动词原形」；原文 = The pandemic(大流行病) will take lives, economies and destroy routines, but it will pass.',
  },
  {
    paper: '2021-06-2',
    no: 26,
    from: 'It was quite a , given where she had been two years earlier.',
    to: 'It was quite a __(26)__, given where she had been two years earlier.',
    why: '答案 ultimately；解析「两个逗号之间的插入语，修饰整句」；原文的空位被抹成空格，位置即那个空格。',
  },
  {
    paper: '2022-12-1',
    no: 27,
    from: 'a schizophrenic\\(',
    to: 'The woman, who later turned out to be a schizophrenic without __(27)__ to her medications.',
    why: '答案 access；解析「介词 without 后接名词」；原文 = a schizophrenic(精神分裂症患者) without to her medications（access 已被空位吃掉）。',
  },
  {
    paper: '2025-06-2',
    no: 34,
    from: "The fibers support the cell's membranes(",
    to: "The fibers support the cell's membranes and proteins, preventing them from breaking or __(34)__.",
    why: '答案 unfolding；解析「介词 from 后并列的动名词」；原文 = …preventing them from breaking or .',
  },
  {
    paper: '2025-12-2',
    no: 27,
    from: 'technology has quashed(',
    to: 'Meanwhile, technology has quashed, one by one, claims that __(27)__ tasks require a human brain.',
    why: '答案 cognitive；解析「名词 tasks 前的前置定语」；原文 = claims that tasks require a human brain。',
  },
];

let n = 0;
const byPaper = new Map();
for (const f of FIXES) {
  const arr = byPaper.get(f.paper) ?? [];
  arr.push(f);
  byPaper.set(f.paper, arr);
}

for (const [paper, fixes] of byPaper) {
  const file = `content/cet6/papers/${paper}.json`;
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  let touched = false;
  for (const f of fixes) {
    const q = p.questions.find((x) => x.no === f.no);
    if (!q) {
      console.log(`✗ ${paper}#${f.no} 找不到题目`);
      continue;
    }
    if (q.stem !== f.from) {
      console.log(`= ${paper}#${f.no} 已不是待修状态（现为 ${JSON.stringify(q.stem.slice(0, 30))}），跳过`);
      continue;
    }
    q.stem = f.to;
    touched = true;
    n++;
    console.log(`✓ ${paper}#${f.no}\n   改后: ${JSON.stringify(f.to)}\n   依据: ${f.why}`);
  }
  if (touched) fs.writeFileSync(file, JSON.stringify(p, null, 2) + '\n');
}
console.log(`\n共修 ${n} 条`);
