'use client';

import { useCallback, useEffect, useState } from 'react';

import type { BookIndex, ListEntry, VocabRoot, WordEntry } from './srs';

/**
 * 词汇数据的客户端读取
 * ============================================================================
 * 数据落点（构建前由 tools/vocab-public.mjs 从 content/vocab 复制）：
 *   /vocab/index.json            书单（7 本，合计 54356 词）
 *   /vocab/<book>/index.json     单本分片索引
 *   /vocab/<book>/list.json      轻量词表（浏览页用，248–929KB）
 *   /vocab/<book>/s01.json …     每片 500 词的完整词条（学习页按需取）
 *   /vocab/<book>/refs.json      真题反查（仅考试类词书）
 *
 * 缓存策略：书单与分片**模块级缓存**（切页不重复取）；词表按书缓存。
 * 失败时清缓存，允许重试 —— 与 use-bank-meta 同一套纪律。
 */

let rootCache: Promise<VocabRoot> | null = null;
const indexCache = new Map<string, Promise<BookIndex>>();
const listCache = new Map<string, Promise<ListEntry[]>>();
const shardCache = new Map<string, Promise<WordEntry[]>>();

export function resetVocabCache() {
  rootCache = null;
  indexCache.clear();
  listCache.clear();
  shardCache.clear();
}

async function getJSON<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${what} 加载失败（HTTP ${res.status}）`);
  return (await res.json()) as T;
}

function once<T>(store: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit) return hit;
  const p = load().catch((e: unknown) => {
    store.delete(key);
    throw e;
  });
  store.set(key, p);
  return p;
}

export function fetchVocabRoot(): Promise<VocabRoot> {
  rootCache ??= getJSON<VocabRoot>('/vocab/index.json', '词书清单').catch((e: unknown) => {
    rootCache = null;
    throw e;
  });
  return rootCache;
}

export function fetchBookIndex(bookId: string): Promise<BookIndex> {
  return once(indexCache, bookId, () =>
    getJSON<BookIndex>(`/vocab/${bookId}/index.json`, `${bookId} 词书索引`),
  );
}

export function fetchBookList(bookId: string): Promise<ListEntry[]> {
  return once(listCache, bookId, () =>
    getJSON<ListEntry[]>(`/vocab/${bookId}/list.json`, `${bookId} 词表`),
  );
}

export function fetchShard(bookId: string, file: string): Promise<WordEntry[]> {
  return once(shardCache, `${bookId}/${file}`, () =>
    getJSON<WordEntry[]>(`/vocab/${bookId}/${file}`, `${bookId} 词条`),
  );
}

/** 真题反查表：word → 出现在站内哪几套真题（没有对应题库的书返回空表） */
export async function fetchRefs(bookId: string): Promise<Record<string, string[]>> {
  try {
    const res = await fetch(`/vocab/${bookId}/refs.json`);
    if (!res.ok) return {};
    return (await res.json()) as Record<string, string[]>;
  } catch {
    return {}; // 反查是增强信息，取不到就当没有，不影响背词
  }
}

/* ---------- hooks ---------- */

type Async<T> = { data: T | null; loading: boolean; error: string | null; reload: () => void };

function useAsync<T>(load: () => Promise<T>, deps: unknown[], initial: T | null = null): Async<T> {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({
    data: initial,
    loading: true,
    error: null,
  });
  const reload = useCallback(() => {
    resetVocabCache();
    setState({ data: initial, loading: true, error: null });
    setNonce((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    load()
      .then((d) => {
        if (alive) setState({ data: d, loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (alive)
          setState({
            data: null,
            loading: false,
            error: e instanceof Error ? e.message : String(e),
          });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps]);

  return { ...state, reload };
}

export const useVocabRoot = () => useAsync(fetchVocabRoot, []);
export const useBookIndex = (bookId: string) => useAsync(() => fetchBookIndex(bookId), [bookId]);
export const useBookList = (bookId: string) => useAsync(() => fetchBookList(bookId), [bookId]);
export const useBookRefs = (bookId: string) => useAsync(() => fetchRefs(bookId), [bookId], {});
