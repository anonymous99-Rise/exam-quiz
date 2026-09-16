#!/usr/bin/env node
/**
 * bank-index.mjs — 重建 content/<exam>/index.json
 *
 * 列表页只需套卷元信息，不该读 8.3MB 全文。索引条目由 schema.toIndexEntry 派生，
 * 与迁移/导入器共用同一份口径，避免"索引说 55 题、实际 54 题"这类不一致。
 *
 * 何时需要跑：migrate-legacy 之后、bank:add 之后、手工改过 papers/ 之后。
 *
 * 用法：node tools/bank-index.mjs [--content <dir>] [--check]
 *   --check  只校验索引是否与 papers/ 一致，不写盘（CI 用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { zPaper, zBankIndex, toIndexEntry } from '../src/lib/bank/schema.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const getArg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const CONTENT = getArg('--content', path.join(PROJECT, 'content'));
const CHECK = argv.includes('--check');
/** 客户端取用的副本目录（错题本/收藏/刷题页要按 qid 定位到 section，不能读 250KB 全文） */
const PUBLIC_DIR = getArg('--public', path.join(PROJECT, 'public', 'bank'));

const exams = fs
  .readdirSync(CONTENT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

let stale = 0;
let written = 0;
const manifest = [];

for (const examId of exams) {
  const dir = path.join(CONTENT, examId);
  const papersDir = path.join(dir, 'papers');
  if (!fs.existsSync(papersDir)) continue;

  const assetsFile = path.join(dir, 'assets.json');
  const assets = fs.existsSync(assetsFile) ? JSON.parse(fs.readFileSync(assetsFile, 'utf8')) : {};

  const entries = [];
  for (const f of fs.readdirSync(papersDir).filter((x) => x.endsWith('.json')).sort()) {
    const parsed = zPaper.safeParse(JSON.parse(fs.readFileSync(path.join(papersDir, f), 'utf8')));
    if (!parsed.success) {
      console.error(`✗ ${examId}/${f} schema 校验失败，索引未生成`);
      process.exit(1);
    }
    // no-audio 是派生标记：有听力题但无音源才算。与 registry.getPaper 保持同一口径。
    const hasAudio = Boolean(assets[parsed.data.id]?.audio);
    const hasListening = parsed.data.questions.some((q) => q.sectionId === 'listening');
    const flags = parsed.data.flags.filter((f) => f !== 'no-audio');
    if (hasListening && !hasAudio) flags.push('no-audio');
    entries.push(toIndexEntry({ ...parsed.data, flags }, hasAudio));
  }

  const index = {
    examId,
    generatedAt: new Date().toISOString(),
    papers: entries,
  };
  zBankIndex.parse(index);

  const outFile = path.join(dir, 'index.json');
  if (CHECK) {
    if (!fs.existsSync(outFile)) {
      console.error(`✗ ${examId}: 缺少 index.json`);
      stale++;
      continue;
    }
    const existing = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    const strip = (i) => JSON.stringify({ ...i, generatedAt: undefined });
    if (strip(existing) !== strip(index)) {
      console.error(`✗ ${examId}: index.json 与 papers/ 不一致（需重跑 bank-index）`);
      stale++;
    } else {
      console.log(`✓ ${examId}: 索引一致（${entries.length} 套）`);
    }
  } else {
    fs.writeFileSync(outFile, JSON.stringify(index, null, 2) + '\n');

    // 客户端副本：错题本/收藏/刷题页需要「qid → 哪套卷的哪一部分」
    const examCfg = JSON.parse(fs.readFileSync(path.join(dir, 'exam.json'), 'utf8'));
    const pubDir = path.join(PUBLIC_DIR, examId);
    fs.mkdirSync(pubDir, { recursive: true });
    fs.writeFileSync(
      path.join(pubDir, 'index.json'),
      JSON.stringify({ examId, papers: entries }),
    );
    manifest.push({
      id: examId,
      name: examCfg.name,
      shortName: examCfg.shortName,
      examDurationMin: examCfg.examDurationMin ?? null,
      sections: examCfg.sections.map((s) => ({ id: s.id, name: s.name, score: s.score ?? 0 })),
      paperCount: entries.length,
    });

    written++;
    const flagged = entries.filter((e) => e.flags.length).length;
    console.log(`✓ ${examId}: ${entries.length} 套（${flagged} 套带 flags） → index.json + public/bank/${examId}/`);
  }
}

if (!CHECK) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  fs.writeFileSync(path.join(PUBLIC_DIR, 'manifest.json'), JSON.stringify({ exams: manifest }));
}

if (CHECK && stale > 0) process.exit(1);
if (!CHECK) console.log(`\n已重建 ${written} 个索引`);
