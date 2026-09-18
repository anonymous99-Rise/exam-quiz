/**
 * LibriVox 有声书适配器
 * ============================================================================
 * LibriVox 是公共领域有声书库（狄更斯、大仲马、简·奥斯汀…），章节 15–40 分钟，
 * 是「长时段泛听」最好的素材。但它和播客不是一种接口：
 *
 *   · 列表接口 `/api/feed/audiobooks?format=json&language=en&limit=N` 返回 **JSON**，
 *     而且**不含章节**（只有 id/title/authors/num_sections/totaltime/url_rss…）；
 *   · 章节要另外取。实测两条路都通：`?id=47&extended=1`（JSON）与
 *     `https://librivox.org/rss/47`（**标准 RSS 2.0 + iTunes 命名空间**）。
 *
 * 这里选**每本书的 RSS**：它是标准格式，能直接喂给 parse.ts 的解析器，
 * 不用为 LibriVox 再写一套章节解析（少一处会坏的地方）。
 *
 * 代价是每轮渲染要发 1 + N 次请求（列表 + 每本书的 RSS）。有 ISR 兜着
 * （1 小时再验证），这个成本可以接受。
 */
import { parseDuration, type FeedSource } from './parse';

export type LibrivoxBook = {
  id: string;
  title: string;
  author: string;
  /** 章节总数（列表接口给的） */
  chapters: number;
  /** 总时长（秒） */
  totalSec: number;
  /** 书籍详情页（列表里被引用） */
  page: string;
  /** 章节 RSS */
  rss: string;
};

type Json = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? '' : String(v).trim());
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** 列表接口 → 书籍数组（纯函数，可单测） */
export function parseLibrivoxBooks(raw: unknown): LibrivoxBook[] {
  const books = (raw as { books?: unknown } | null)?.books;
  if (!Array.isArray(books)) return [];

  const out: LibrivoxBook[] = [];
  for (const b of books) {
    if (typeof b !== 'object' || b === null) continue;
    const book = b as Json;
    const id = str(book.id);
    const rss = str(book.url_rss);
    if (!id || !rss) continue;

    const authors = Array.isArray(book.authors) ? (book.authors as Json[]) : [];
    const author =
      authors
        .map((a) => [str(a.first_name), str(a.last_name)].filter(Boolean).join(' '))
        .filter(Boolean)
        .join(', ') || '佚名';

    out.push({
      id,
      title: str(book.title) || `LibriVox #${id}`,
      author,
      chapters: num(book.num_sections),
      /*
       * 实测字段名是 `totaltimesecs`（无下划线），另一个 `totaltime` 是 `49:43:15` 字符串。
       * 两个都认：秒数优先，没有就把 H:MM:SS 解出来。
       */
      totalSec: num(book.totaltimesecs) || parseDuration(str(book.totaltime)) || 0,
      page: str(book.url_librivox) || str(book.url_project) || `https://librivox.org/${id}`,
      rss,
    });
  }
  return out;
}

/** 列表接口地址（列表 + 语言 + 条数） */
export const LIBRIVOX_LIST_URL =
  'https://librivox.org/api/feed/audiobooks?format=json&language=en&limit=6';

/**
 * 每本书最多列几章。
 *
 * 像《基督山伯爵》有 100+ 章，全列出来会把列表撑成几页而且没有意义
 * （听有声书不会从第 70 章开始）。每个节目列前若干章，并注明总章数。
 */
export const CHAPTERS_PER_BOOK = 6;

/** 伪造成 FeedSource，好让 per-book RSS 复用同一个解析器 */
export function bookAsSource(book: LibrivoxBook, base: FeedSource): FeedSource {
  return { ...base, id: `librivox-${book.id}`, title: book.title, url: book.rss };
}
