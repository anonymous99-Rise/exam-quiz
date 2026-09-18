/**
 * LibriVox 适配器单测
 *
 * 关注的不是「能不能解析 JSON」，而是**上游字段的怪癖**：
 *   · 列表接口不含章节（要另外取 url_rss）；
 *   · 时长字段有两个名字（totaltime / totaltime_secs）；
 *   · 作者是数组，且first_name/last_name 可能为空；
 *   · 没有 url_rss 的书要直接跳过，而不是产出一条点不动的行。
 */
import { describe, expect, it } from 'vitest';

import { bookAsSource, parseLibrivoxBooks, type LibrivoxBook } from './librivox';
import { parseFeed, type FeedSource } from './parse';

const base: FeedSource = {
  id: 'librivox',
  title: 'LibriVox 有声书',
  short: '有声书',
  kind: 'podcast',
  url: 'https://librivox.org/api/feed/audiobooks?format=json&language=en&limit=6',
  homeUrl: 'https://librivox.org/',
  lang: 'en',
  genre: '有声书',
  note: 'n',
  format: 'librivox',
};

const listPayload = {
  books: [
    {
      id: '47',
      title: 'Count of Monte Cristo',
      description: '<i>The Count of Monte Cristo</i> is an adventure novel…',
      url_librivox: 'https://librivox.org/the-count-of-monte-cristo-by-alexandre-dumas/',
      url_rss: 'https://librivox.org/rss/47',
      num_sections: '115',
      totaltime: '49:43:15',
      totaltimesecs: '179027',
      authors: [{ first_name: 'Alexandre', last_name: 'Dumas' }],
    },
    {
      id: '52',
      title: 'Letters of Two Brides',
      url_rss: 'https://librivox.org/rss/52',
      num_sections: 30,
      totaltimesecs: 32960,
      authors: [{ first_name: 'Honoré', last_name: 'de Balzac' }],
    },
    // 没有 rss 的书 → 跳过（点不动的行没有意义）
    { id: '99', title: 'No RSS Book', num_sections: 3 },
    // 脏数据 → 跳过
    null,
    'boom',
  ],
};

describe('LibriVox 列表归一化', () => {
  it('取到书、作者、章节数、时长、RSS 与详情页', () => {
    const books = parseLibrivoxBooks(listPayload);
    expect(books).toHaveLength(2);

    const first = books[0]!;
    expect(first.id).toBe('47');
    expect(first.title).toBe('Count of Monte Cristo');
    expect(first.author).toBe('Alexandre Dumas');
    expect(first.chapters).toBe(115);
    expect(first.totalSec).toBe(179027);
    expect(first.rss).toBe('https://librivox.org/rss/47');
    expect(first.page).toContain('librivox.org/the-count-of-monte-cristo');
  });

  it('章节数/时长是字符串也认；没有详情页时按 id 兜底', () => {
    const books = parseLibrivoxBooks(listPayload);
    const second = books[1]!;
    expect(second.chapters).toBe(30);
    expect(second.totalSec).toBe(32960);
    expect(second.page).toBe('https://librivox.org/52');
  });

  it('缺 url_rss 的书与脏元素一律跳过', () => {
    const books = parseLibrivoxBooks({ books: [{ id: '1', title: 'x' }, null, 42] });
    expect(books).toHaveLength(0);
  });

  it('结构完全不对时返回空数组，不抛错', () => {
    expect(parseLibrivoxBooks(null)).toEqual([]);
    expect(parseLibrivoxBooks({})).toEqual([]);
    expect(parseLibrivoxBooks('boom')).toEqual([]);
  });

  it('作者缺失时给「佚名」，不留空字符串', () => {
    const books = parseLibrivoxBooks({ books: [{ id: '5', title: 'T', url_rss: 'https://librivox.org/rss/5' }] });
    expect(books[0]!.author).toBe('佚名');
  });
});

describe('每本书的 RSS 复用同一个解析器', () => {
  const book: LibrivoxBook = parseLibrivoxBooks(listPayload)[0]!;

  const chapterRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title><![CDATA[Count of Monte Cristo, The by Alexandre Dumas]]></title>
    <link>https://librivox.org/the-count-of-monte-cristo-by-alexandre-dumas/</link>
    <item>
      <title><![CDATA[001 - Chapter 1]]></title>
      <link>https://librivox.org/the-count-of-monte-cristo-by-alexandre-dumas/</link>
      <enclosure url="https://archive.org/download/monte_cristo_1005_librivox/montecristo_001_dumas.mp3" length="24123456" type="audio/mpeg"/>
      <itunes:duration>1583</itunes:duration>
      <description><![CDATA[Chapter 1 of the novel.]]></description>
    </item>
  </channel>
</rss>`;

  it('bookAsSource 造出的伪源能解析出章节音频', () => {
    const ch = parseFeed(chapterRss, bookAsSource(book, base));
    expect(ch).not.toBeNull();
    expect(ch!.items).toHaveLength(1);
    const item = ch!.items[0]!;
    expect(item.title).toBe('001 - Chapter 1');
    expect(item.audio?.url).toContain('.mp3');
    expect(item.audio?.durationSec).toBe(1583);
    expect(item.audio?.url.startsWith('https://')).toBe(true);
  });
});
