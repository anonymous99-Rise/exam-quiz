'use client';

import { useEffect, useMemo, useState } from 'react';

import type { ExamConfig, PaperIndexEntry } from './schema';

/**
 * 客户端题库元数据
 * ============================================================================
 * 错题本 / 收藏 / 刷题页都在浏览器里跑，它们需要「qid → 哪套卷的哪一部分」，
 * 但不该为此加载 250KB 的试卷全文。
 *
 * 于是 bank-index.mjs 会把一份**压缩版索引**同时写到 public/bank/：
 *   public/bank/manifest.json      考试清单（名称 / 分值 / section）
 *   public/bank/<examId>/index.json 套卷索引（含 sectionNos）
 * 全部考试合计约 24KB，一次取回，模块级缓存。
 */

export type ExamMeta = {
  id: string;
  name: string;
  shortName: string;
  examDurationMin: number | null;
  sections: { id: string; name: string; score: number }[];
  paperCount: number;
};

type Manifest = { exams: ExamMeta[] };
type BankIndexLite = { examId: string; papers: PaperIndexEntry[] };

let cache: Promise<{ manifest: Manifest; indexes: Record<string, BankIndexLite> }> | null = null;

function loadAll() {
  cache ??= (async () => {
    const mres = await fetch('/bank/manifest.json');
    if (!mres.ok) throw new Error('manifest 加载失败');
    const manifest = (await mres.json()) as Manifest;

    const pairs = await Promise.all(
      manifest.exams.map(async (e) => {
        const res = await fetch(`/bank/${e.id}/index.json`);
        if (!res.ok) throw new Error(`${e.id} 索引加载失败`);
        return [e.id, (await res.json()) as BankIndexLite] as const;
      }),
    );
    return { manifest, indexes: Object.fromEntries(pairs) };
  })();
  return cache;
}

export function useBankMeta() {
  const [state, setState] = useState<{
    loading: boolean;
    error: string | null;
    manifest: Manifest['exams'];
    indexes: Record<string, BankIndexLite>;
  }>({ loading: true, error: null, manifest: [], indexes: {} });

  useEffect(() => {
    let alive = true;
    loadAll()
      .then((d) => {
        if (alive) setState({ loading: false, error: null, manifest: d.manifest.exams, indexes: d.indexes });
      })
      .catch((e: unknown) => {
        if (alive) {
          setState({
            loading: false,
            error: e instanceof Error ? e.message : String(e),
            manifest: [],
            indexes: {},
          });
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}

/* ==========================================================================
   qid 定位
   ========================================================================== */

export type QidLocation = {
  /** 原始 key（含考试前缀），用于回写 store —— 不要自己拼，拼错就会串考试 */
  key: string;
  examId: string;
  examShortName: string;
  paperId: string;
  /** '2025年6月 · 第1套' */
  paperTitle: string;
  sectionId: string;
  sectionName: string;
  no: number;
  /** 可直达的链接（带 hash 定位到具体题） */
  href: string;
};

/** `${examId}/${paperId}` → 索引条目 */
type PaperLookup = Map<string, { exam: ExamMeta; paper: PaperIndexEntry }>;

/**
 * 把 `key` 反解成位置。
 * key 支持两种形态：
 *   `${examId}/${paperId}#${no}` —— 带考试前缀（新站写法，推荐）
 *   `${paperId}#${no}`           —— 旧站写法（M7 合并旧数据时会用到）
 */
export function useQidLocator() {
  const { manifest, indexes, loading, error } = useBankMeta();

  const lookup: PaperLookup = useMemo(() => {
    const m: PaperLookup = new Map();
    for (const exam of manifest) {
      const idx = indexes[exam.id];
      if (!idx) continue;
      for (const paper of idx.papers) m.set(`${exam.id}/${paper.id}`, { exam, paper });
      // 兼容旧站写法：不带考试前缀，后写的会覆盖同 id 的（当前只有一个考试，无歧义）
      for (const paper of idx.papers) {
        const k = paper.id;
        if (!m.has(k)) m.set(k, { exam, paper });
      }
    }
    return m;
  }, [manifest, indexes]);

  const locate = (key: string): QidLocation | null => {
    const i = key.lastIndexOf('#');
    if (i < 0) return null;
    const rawPaper = key.slice(0, i);
    const no = Number(key.slice(i + 1));
    if (!Number.isFinite(no)) return null;

    const hit = lookup.get(rawPaper);
    if (!hit) return null;
    const { exam, paper } = hit;

    const sectionId = Object.entries(paper.sectionNos).find(([, nos]) => nos.includes(no))?.[0] ?? '';
    const sectionName = exam.sections.find((s) => s.id === sectionId)?.name ?? sectionId;
    const examId = exam.id;

    return {
      key,
      examId,
      examShortName: exam.shortName,
      paperId: paper.id,
      paperTitle: `${paper.label} · 第${paper.setNo}套`,
      sectionId,
      sectionName,
      no,
      href: sectionId ? `/${examId}/${paper.id}/${sectionId}#q-${no}` : `/${examId}/${paper.id}`,
    };
  };

  return { locate, loading, error, exams: manifest };
}

/** 把一串 qid 按「考试 → 套卷」聚成树，供错题本/收藏渲染 */
export function groupLocations(
  keys: string[],
  locate: (k: string) => QidLocation | null,
): { exam: string; examId: string; papers: { title: string; paperId: string; items: QidLocation[] }[] }[] {
  const byExam = new Map<string, Map<string, QidLocation[]>>();
  const examNames = new Map<string, string>();

  for (const k of keys) {
    const loc = locate(k);
    if (!loc) continue;
    examNames.set(loc.examId, loc.examShortName);
    const papers = byExam.get(loc.examId) ?? new Map<string, QidLocation[]>();
    const arr = papers.get(loc.paperId) ?? [];
    arr.push(loc);
    papers.set(loc.paperId, arr);
    byExam.set(loc.examId, papers);
  }

  return [...byExam.entries()].map(([examId, papers]) => ({
    examId,
    exam: examNames.get(examId) ?? examId,
    papers: [...papers.entries()].map(([paperId, items]) => ({
      paperId,
      title: items[0]?.paperTitle ?? paperId,
      items: items.sort((a, b) => a.no - b.no),
    })),
  }));
}

export type { ExamConfig };
