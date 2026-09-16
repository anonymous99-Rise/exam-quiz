#!/usr/bin/env node
/**
 * 临时诊断脚本：把某个 Word/PDF 转成文本并打印结构行，用于排查抽取失败
 * （一次性工具，排查完可删）
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const file = process.argv[2];
if (!file) {
  console.error('用法：node tools/debug-text.mjs <文件> [关键词]');
  process.exit(2);
}
const abs = path.resolve(file);
const ext = path.extname(abs).toLowerCase();
let text;

if (ext === '.docx') {
  const unzip = [
    path.join(process.env.LOCALAPPDATA ?? '', 'hermes/git/usr/bin/unzip.exe'),
    'C:/Program Files/Git/usr/bin/unzip.exe',
  ].find((p) => fs.existsSync(p));
  const xml = execFileSync(unzip, ['-p', abs, 'word/document.xml'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  text = xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
} else if (ext === '.doc' || ext === '.rtf') {
  const tmp = path.join(os.tmpdir(), `debug-${Date.now()}.txt`);
  // 与 doc-extract 一致：取 Content.Text 自己写 UTF-8，避免 ANSI/UTF-16 的格式猜测
  const ps = `
$ErrorActionPreference='Stop'
$w = New-Object -ComObject Word.Application
$w.Visible=$false; $w.DisplayAlerts=0
$d = $w.Documents.Open('${abs.replace(/'/g, "''")}', $false, $true, $false)
$t = $d.Content.Text
$d.Close(0); $w.Quit()
[System.IO.File]::WriteAllText('${tmp.replace(/'/g, "''")}', $t, (New-Object System.Text.UTF8Encoding($false)))
`;
  execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'pipe' });
  text = fs.readFileSync(tmp, 'utf8');
} else {
  const exe = path.join(
    process.env.LOCALAPPDATA ?? '',
    'Microsoft/WinGet/Packages/oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe/poppler-25.07.0/Library/bin/pdftotext.exe',
  );
  text = execFileSync(exe, ['-layout', abs, '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
}

// 统一行尾：Word 导出的文本可能是 CRLF / CR / LF 三种
text = text.replace(/\r\n?/g, '\n');

const kw = process.argv[3];
if (kw && /^--dump/.test(kw)) {
  const m = kw.match(/^--dump(?:=(\d+)-(\d+))?$/);
  const from = m?.[1] ? Number(m[1]) : 0;
  const to = m?.[2] ? Number(m[2]) : 80;
  const L = text.split('\n');
  console.log(`总行数 ${L.length}，总字数 ${text.length}（打印 ${from}–${to}）`);
  for (let i = from; i <= to && i < L.length; i++) {
    const t = L[i].trim();
    if (t) console.log(`${String(i).padStart(5)}  ${t.slice(0, 100)}`);
  }
} else if (kw) {
  const i = text.indexOf(kw);
  console.log(`关键词「${kw}」位置：${i}`);
  if (i >= 0) console.log(text.slice(Math.max(0, i - 200), i + 1200));
} else {
  const L = text.split('\n');
  console.log(`总行数 ${L.length}，总字数 ${text.length}`);
  console.log('=== 结构行 ===');
  L.forEach((raw, i) => {
    const l = raw.trim();
    if (
      /^Part\s+[IV]/.test(l) ||
      /^Section\s+[ABC]\s*$/.test(l) ||
      /^Questions?\s+\d+/.test(l) ||
      /^\d{1,2}[.)]\s/.test(l) ||
      /^[A-O][).]\s/.test(l) ||
      /word bank/i.test(l)
    ) {
      console.log(`  ${String(i).padStart(5)}  ${l.slice(0, 88)}`);
    }
  });
}
