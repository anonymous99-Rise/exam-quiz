#!/usr/bin/env node
/**
 * fix-legacy-defects.mjs — 显式修复已确诊的旧站数据缺陷
 *
 * 为什么单独一个工具而不是塞进迁移脚本：
 *   迁移的原则是「不篡改内容，只做结构归一化」。而下面这些是**内容错误**，
 *   必须是一次可 review、可追溯、可回滚的独立动作，并且在缺陷台账里留痕。
 *
 * 每条修复都有明确证据（见 docs/legacy-defects.md），不做任何推测性改动。
 *
 * 用法：
 *   node tools/fix-legacy-defects.mjs            # 只报告将要做的改动
 *   node tools/fix-legacy-defects.mjs --apply    # 实际写入
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');
const CONTENT = path.join(PROJECT, 'content');
const APPLY = process.argv.includes('--apply');

/**
 * 修复清单。每条：
 *   paper  套卷 id
 *   id     缺陷编号（对应 docs/legacy-defects.md）
 *   why    证据
 *   apply  在 paper 对象上就地修改
 */
const FIXES = [
  {
    paper: '2021-06-2',
    id: 'D2-a',
    why:
      '该套出现两个题号 31、且缺 26。前一个「31」的题干是 ' +
      '"It was quite a , given where she had been two years earlier."（无 __(31)__ 标记），' +
      '按完形填空的题序（26–35）它就是第 26 题。' +
      '⚠ 不修的话两个 #31 的 qid 相同，会共享同一个作答槽 —— 这是运行时的真 bug。',
    apply(paper) {
      const qs = paper.questions.filter((q) => q.no === 31);
      if (qs.length !== 2) return null;
      // 认标记缺失的那个（题干里没有 __(31)__）
      const target = qs.find((q) => !/__\(31\)__/.test(q.stem));
      if (!target) return null;
      target.no = 26;
      return `#31 → #26（题干：${target.stem.slice(0, 40)}…）`;
    },
  },
  {
    paper: '2021-06-1',
    id: 'D2-b',
    why:
      '第 34 题题干里的题号标记写成了 __(33)__（#33 答案 G、#34 答案 A，是两个不同的空位），' +
      '属标记未同步。只改标记文本，不动题干其余内容与答案。',
    apply(paper) {
      const q34 = paper.questions.find((q) => q.no === 34);
      if (!q34 || !/__\(33\)__/.test(q34.stem)) return null;
      const before = q34.stem;
      q34.stem = q34.stem.replace(/__\(33\)__/, '__(34)__');
      if (q34.stem === before) return null;
      return `题干标记 __(33)__ → __(34)__`;
    },
  },
];

let changed = 0;
let skipped = 0;

for (const fix of FIXES) {
  const file = path.join(CONTENT, fix.paper.slice(0, 4) === '' ? '' : '');
  void file;
  // 在 content/ 下找出该套卷（考试前缀未知，遍历考试目录）
  let target = null;
  for (const examId of fs.readdirSync(CONTENT, { withFileTypes: true })) {
    if (!examId.isDirectory()) continue;
    const p = path.join(CONTENT, examId.name, 'papers', `${fix.paper}.json`);
    if (fs.existsSync(p)) {
      target = p;
      break;
    }
  }
  if (!target) {
    console.log(`⚠ ${fix.paper}（${fix.id}）：找不到该套卷，跳过`);
    skipped++;
    continue;
  }

  const paper = JSON.parse(fs.readFileSync(target, 'utf8'));
  const desc = fix.apply(paper);

  if (!desc) {
    console.log(`· ${fix.paper}（${fix.id}）：无需修改（可能已修过）`);
    skipped++;
    continue;
  }

  console.log(`✓ ${fix.paper}（${fix.id}）：${desc}`);
  console.log(`    依据：${fix.why}`);

  if (APPLY) {
    paper.questions.sort((a, b) => a.no - b.no);
    fs.writeFileSync(target, JSON.stringify(paper, null, 2) + '\n');
    console.log(`    已写入 ${path.relative(PROJECT, target)}`);
  }
  changed++;
}

console.log('');
if (!APPLY) {
  console.log(`预演：${changed} 处待修，${skipped} 处跳过。加 --apply 实际写入。`);
} else {
  console.log(`完成：${changed} 处已修，${skipped} 处跳过。`);
  console.log('下一步：node tools/bank-index.mjs && node tools/bank-validate.mjs');
}
