#!/usr/bin/env node
/**
 * pdf-text.mjs — 把 PDF 的文本层导出到文件，供排查/规则开发使用
 *
 * （一次性排查工具：解析 PDF 的排版规则开发时，需要反复看真实文本）
 *
 * 用法：
 *   node tools/pdf-text.mjs <pdf> [--out <file>] [--pages 1-3] [--layout]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const getArg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const pdf = argv.find((a) => !a.startsWith('--') && a !== getArg('--out') && a !== getArg('--pages'));
if (!pdf) {
  console.error('用法：node tools/pdf-text.mjs <pdf> [--out <file>] [--pages 1-3]');
  process.exit(2);
}
const abs = path.resolve(pdf);
const out = getArg('--out', path.join(PROJECT, 'tmp', path.basename(pdf).replace(/\.pdf$/i, '.txt')));
const pages = getArg('--pages');
const layout = argv.includes('--layout');

const exe = [
  path.join(
    process.env.LOCALAPPDATA ?? '',
    'Microsoft/WinGet/Packages/oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe/poppler-25.07.0/Library/bin/pdftotext.exe',
  ),
  'pdftotext',
].find((p) => p === 'pdftotext' || fs.existsSync(p));

const args = [];
if (layout) args.push('-layout');
if (pages) {
  const [a, b] = pages.split('-');
  args.push('-f', a, '-l', b ?? a);
}
args.push(abs, out);

fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync(exe, args, { stdio: 'pipe' });

let text = fs.readFileSync(out, 'utf8');
text = text.replace(/\f/g, '\n---PAGE---\n'); // 换页符替换成可读标记
fs.writeFileSync(out, text, 'utf8');

const lines = text.split('\n');
console.log(`✓ ${path.relative(PROJECT, out)}`);
console.log(`  行数 ${lines.length}，字数 ${text.length}`);
console.log('=== 前 60 行 ===');
lines.slice(0, 60).forEach((l, i) => console.log(`${String(i).padStart(4)}  ${l.slice(0, 96)}`));
