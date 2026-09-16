/**
 * 题库注册表 —— 构建期/服务端读取 content/ 的唯一入口
 * ============================================================================
 * 三条纪律：
 *   1. 列表页只读 index.json（17 KB），详情页才读 papers/<id>.json（~250 KB）。
 *   2. 所有读出的 JSON 都过 Zod —— 坏数据在这里就炸，不会渗进 UI。
 *   3. 只做读取与派生，不做校验修复（修复是 tools/ 的事）。
 *
 * 新增考试 = 在 content/ 下加一个目录，本文件**不需要改**。
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  zBankIndex,
  zExamConfig,
  zPaper,
  zPaperAssets,
  type BankIndex,
  type ExamConfig,
  type Paper,
  type PaperAssets,
  type PaperIndexEntry,
  type Section,
} from './schema';

const CONTENT_DIR = path.join(process.cwd(), 'content');

/* ---------- 缓存 ---------- */
const examCache = new Map<string, ExamConfig>();
const indexCache = new Map<string, BankIndex>();
const paperCache = new Map<string, Paper>();
/** 每套卷的资产表（原卷 PDF / 解析 PDF / 听力），来自 assets.json */
const assetsCache = new Map<string, Record<string, PaperAssets>>();

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/* ---------- 考试 ---------- */

export function listExamIds(): string[] {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  return fs
    .readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(CONTENT_DIR, d.name, 'exam.json')))
    .map((d) => d.name)
    .sort();
}

export function getExamConfig(examId: string): ExamConfig | null {
  const hit = examCache.get(examId);
  if (hit) return hit;
  const raw = readJson(path.join(CONTENT_DIR, examId, 'exam.json'));
  if (!raw) return null;
  const parsed = zExamConfig.safeParse(raw);
  if (!parsed.success) {
    console.error(`[registry] ${examId}/exam.json 校验失败`, parsed.error.issues.slice(0, 5));
    return null;
  }
  examCache.set(examId, parsed.data);
  return parsed.data;
}

export function getExamIndex(examId: string): BankIndex | null {
  const hit = indexCache.get(examId);
  if (hit) return hit;
  const raw = readJson(path.join(CONTENT_DIR, examId, 'index.json'));
  if (!raw) return null;
  const parsed = zBankIndex.safeParse(raw);
  if (!parsed.success) {
    console.error(`[registry] ${examId}/index.json 校验失败`, parsed.error.issues.slice(0, 5));
    return null;
  }
  indexCache.set(examId, parsed.data);
  return parsed.data;
}

/* ---------- 试卷 ---------- */

export function getPaper(examId: string, paperId: string): Paper | null {
  const key = `${examId}/${paperId}`;
  const hit = paperCache.get(key);
  if (hit) return hit;
  // 防目录穿越：paperId 必须形如 2025-06-1
  if (!/^\d{4}-\d{2}-\d+$/.test(paperId)) return null;
  const raw = readJson(path.join(CONTENT_DIR, examId, 'papers', `${paperId}.json`));
  if (!raw) return null;
  const parsed = zPaper.safeParse(raw);
  if (!parsed.success) {
    console.error(`[registry] ${key} 校验失败`, parsed.error.issues.slice(0, 5));
    return null;
  }
  // 合并外部资产表（paper.assets 里的键优先，缺项用 assets.json 补）
  const external = getPaperAssets(examId)[paperId];
  const merged: Paper = external
    ? { ...parsed.data, assets: { ...external, ...parsed.data.assets } }
    : parsed.data;

  /*
   * `no-audio` 是**派生标记**，不是内容的一部分。
   *
   * 迁移时它按当时的音源算（旧站 27 套 HLS），之后 tools/assets-audio.mjs
   * 又给若干套换上了自托管 mp3 —— 若沿用 paper JSON 里的旧值，就会出现
   * 「明明有音频却挂着『无听力音频』横幅」。
   * 这里按合并后的资产重算，并明确语义：**有听力题但无音源**才算 no-audio。
   */
  const hasListening = merged.questions.some((q) => q.sectionId === 'listening');
  // 显式循环而不用 filter：filter 会把 'no-audio' 从类型里收窄掉，后面就 push 不回来了
  const flags: Paper['flags'] = [];
  for (const f of merged.flags) if (f !== 'no-audio') flags.push(f);
  if (hasListening && !merged.assets?.audio) flags.push('no-audio');

  const paper: Paper = { ...merged, flags };
  paperCache.set(key, paper);
  return paper;
}

/**
 * 资产表：assets.json 是独立文件（由 tools/assets-audio.mjs 与 M9 的资产管线写入），
 * 而 Paper.assets 是 schema 里的内嵌字段。getPaper 会把两者合并，
 * 于是页面统一读 `paper.assets` 即可 —— 不必到处记得去读 assets.json。
 */
export function getPaperAssets(examId: string): Record<string, PaperAssets> {
  const hit = assetsCache.get(examId);
  if (hit) return hit;
  const raw = readJson<Record<string, unknown>>(path.join(CONTENT_DIR, examId, 'assets.json'));
  const safe: Record<string, PaperAssets> = {};
  if (raw) {
    for (const [pid, v] of Object.entries(raw)) {
      const parsed = zPaperAssets.safeParse(v);
      if (parsed.success) safe[pid] = parsed.data;
      else console.error(`[registry] ${examId}/assets.json ${pid} 校验失败`, parsed.error.issues[0]);
    }
  }
  assetsCache.set(examId, safe);
  return safe;
}

export function listPaperEntries(examId: string): PaperIndexEntry[] {
  return getExamIndex(examId)?.papers ?? [];
}

/* ---------- 派生视图 ---------- */

export type SessionGroup = {
  session: string;
  year: number;
  half: '上半年' | '下半年' | '其它';
  papers: PaperIndexEntry[];
};

/**
 * 按考期分组（考期顺序取 exam.json 的 sessions，缺失的排最后）。
 * 注意：paper.year/month 是考试实际日期，session 才是行政考期 —— 分组必须用 session。
 */
export function groupBySession(examId: string): SessionGroup[] {
  const exam = getExamConfig(examId);
  const entries = listPaperEntries(examId);
  const order = new Map((exam?.sessions ?? []).map((s, i) => [s.name, i]));

  const groups = new Map<string, SessionGroup>();
  for (const p of entries) {
    let g = groups.get(p.session);
    if (!g) {
      const known = exam?.sessions.find((s) => s.name === p.session);
      g = {
        session: p.session,
        year: known?.year ?? p.year,
        half: known?.half ?? '其它',
        papers: [],
      };
      groups.set(p.session, g);
    }
    g.papers.push(p);
  }

  for (const g of groups.values()) {
    g.papers.sort((a, b) => a.year - b.year || a.month - b.month || a.setNo - b.setNo);
  }

  return [...groups.values()].sort((a, b) => {
    const oa = order.get(a.session) ?? Number.MAX_SAFE_INTEGER;
    const ob = order.get(b.session) ?? Number.MAX_SAFE_INTEGER;
    return oa - ob || a.year - b.year || a.session.localeCompare(b.session);
  });
}

/** 按年份分组（首页给年份卡片用） */
export function groupByYear(examId: string): { year: number; papers: PaperIndexEntry[] }[] {
  const byYear = new Map<number, PaperIndexEntry[]>();
  for (const p of listPaperEntries(examId)) {
    const arr = byYear.get(p.year) ?? [];
    arr.push(p);
    byYear.set(p.year, arr);
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, papers]) => ({
      year,
      papers: papers.sort((a, b) => a.month - b.month || a.setNo - b.setNo),
    }));
}

/** 取试卷的某个 section（用于按 section 渲染） */
export function sectionOf(paper: Paper, exam: ExamConfig, sectionId: string): Section | null {
  return exam.sections.find((s) => s.id === sectionId) ?? null;
}

/** 试卷标题：'2025年6月 · 第1套' */
export function paperTitle(p: PaperIndexEntry | Paper): string {
  return `${p.label} · 第${p.setNo}套`;
}

/** 考试总览（首页用） */
export function getExamSummaries() {
  return listExamIds().map((id) => {
    const exam = getExamConfig(id);
    const papers = listPaperEntries(id);
    return {
      id,
      name: exam?.name ?? id,
      shortName: exam?.shortName ?? id.toUpperCase(),
      description: exam?.description,
      paperCount: papers.length,
      questionCount: papers.reduce((a, p) => a + p.questionCount, 0),
      sessionCount: new Set(papers.map((p) => p.session)).size,
      yearRange: papers.length
        ? ([Math.min(...papers.map((p) => p.year)), Math.max(...papers.map((p) => p.year))] as const)
        : null,
    };
  });
}
