/**
 * 订阅源解析 —— 合成用例
 *
 * 真样本回归（parse.sample.test.ts）覆盖了 RSS 2.0 / RSS 1.0 与各家怪癖，
 * 这里补三类**样本里没有**的情况：Atom（10 个源都不是 Atom）、解析前限量、
 * 以及各种脏数据（缺字段、坏日期、图片 enclosure、双重转义）。
 */
import { describe, expect, it } from 'vitest';

import {
  capItems,
  decodeEntities,
  htmlToText,
  parseDate,
  parseDuration,
  parseFeed,
  toSummary,
  upgradeAudioUrl,
  type FeedSource,
} from './parse';

/** 取首条（测试里已断言存在，这里收窄类型） */
const firstOf = (ch: ReturnType<typeof parseFeed>) => ch!.items[0]!;

const src = (kind: FeedSource['kind'] = 'podcast'): FeedSource => ({  id: 't',
  title: 'T',
  short: 'T',
  kind,
  url: 'https://example.com/feed.xml',
  homeUrl: 'https://example.com/',
  lang: 'en',
  genre: 'g',
  note: 'n',
});

describe('实体与 HTML', () => {
  it('命名 / 十进制 / 十六进制实体都能解', () => {
    expect(decodeEntities('a &amp; b &lt;i&gt; c &#8217; d &#x2014;')).toBe('a & b <i> c \u2019 d \u2014');
  });

  it('未知实体原样保留（不要把 &foo; 吞掉）', () => {
    expect(decodeEntities('x &unknownentity; y')).toBe('x &unknownentity; y');
  });

  it('**先解实体再剥标签** —— feedx 把整段 HTML 实体转义后塞进 description', () => {
    const html = '&lt;div&gt;&lt;p&gt;First para.&lt;/p&gt;&lt;p&gt;Second para.&lt;/p&gt;&lt;/div&gt;';
    expect(htmlToText(html)).toBe('First para.\n\nSecond para.');
  });

  it('块级标签补空行、li 变项目符号、script/style 丢掉', () => {
    const html = '<p>One</p><ul><li>A</li><li>B</li></ul><script>evil()</script><style>.x{}</style>';
    const text = htmlToText(html);
    expect(text).toContain('One');
    expect(text).toContain('· A');
    expect(text).toContain('· B');
    expect(text).not.toContain('evil');
    expect(text).not.toContain('.x{}');
  });

  it('摘要抹成一行并在句末截断', () => {
    const long = `${'This is a sentence. '.repeat(40)}`;
    const s = toSummary(long, 120);
    expect(s.length).toBeLessThanOrEqual(122);
    expect(s.endsWith('…')).toBe(true);
    expect(s).not.toContain('\n');
  });
});

describe('时长三种写法', () => {
  it('纯秒（BBC）', () => expect(parseDuration('381')).toBe(381));
  it('分:秒（TED）', () => expect(parseDuration('21:42')).toBe(21 * 60 + 42));
  it('时:分:秒', () => expect(parseDuration('1:02:03')).toBe(3723));
  it('异常值给 null，不猜', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('999999')).toBeNull(); // 超过 12 小时视为脏数据
  });
});

describe('日期', () => {
  it('RFC822 带 +0000', () => {
    expect(parseDate('Thu, 17 Sep 2026 08:34:00 +0000')).toBe('2026-09-17T08:34:00.000Z');
  });

  it('RFC822 带时区缩写 EDT（ScienceDaily 的真实写法）', () => {
    // EDT = UTC-4 → 14:42:52 EDT 应为 18:42:52Z
    expect(parseDate('Thu, 17 Sep 2026 14:42:52 EDT')).toBe('2026-09-17T18:42:52.000Z');
  });

  it('GMT 与 +0800', () => {
    expect(parseDate('Thu, 17 Sep 2026 15:00:00 GMT')).toBe('2026-09-17T15:00:00.000Z');
    expect(parseDate('Fri, 18 Sep 2026 00:21:06 +0800')).toBe('2026-09-17T16:21:06.000Z');
  });

  it('ISO 与纯日期（Nature 的 dc:date）', () => {
    expect(parseDate('2026-09-18')).toBe('2026-09-18T00:00:00.000Z');
    expect(parseDate('2026-09-18T01:02:03Z')).toBe('2026-09-18T01:02:03.000Z');
  });

  it('认不出来给 null（列表排序不能因为一条脏日期全乱）', () => {
    expect(parseDate('昨天')).toBeNull();
    expect(parseDate('')).toBeNull();
  });
});

describe('音频地址协议升级', () => {
  it('BBC 的 http 升到 https（否则被混合内容拦）', () => {
    expect(upgradeAudioUrl('http://open.live.bbc.co.uk/a/b.mp3')).toBe(
      'https://open.live.bbc.co.uk/a/b.mp3',
    );
  });
  it('非白名单主机不动（避免把本来只有 http 的源改坏）', () => {
    expect(upgradeAudioUrl('http://example.com/a.mp3')).toBe('http://example.com/a.mp3');
    expect(upgradeAudioUrl('https://x.com/a.mp3')).toBe('https://x.com/a.mp3');
  });
});

describe('解析前限量', () => {
  const many = `<rss version="2.0"><channel><title>C</title>${Array.from(
    { length: 500 },
    (_, i) => `<item><title>t${i}</title><link>https://e.com/${i}</link><description>d</description></item>`,
  ).join('')}</channel></rss>`;

  it('切到前 N 条且补全根闭合标签（结构仍合法）', () => {
    // threshold 传 0 强制走截断分支（真实小源会短路跳过扫描）
    const cut = capItems(many, 5, 0);
    expect((cut.match(/<item>/g) ?? []).length).toBe(5);
    expect(cut.trimEnd().endsWith('</channel></rss>')).toBe(true);
  });

  it('小源直接原样返回（不做无谓扫描）', () => {
    expect(capItems(many, 5)).toBe(many);
  });

  it('RDF 与 Atom 走各自的根闭合', () => {
    const rdf = `<rdf:RDF><channel><title>C</title></channel>${Array.from({ length: 40 }, (_, i) => `<item rdf:about="https://e.com/${i}"><title>t${i}</title></item>`).join('')}</rdf:RDF>`;
    const feed = `<feed xmlns="http://www.w3.org/2005/Atom"><title>C</title>${Array.from({ length: 40 }, (_, i) => `<entry><title>t${i}</title><link href="https://e.com/${i}"/></entry>`).join('')}</feed>`;
    expect(capItems(rdf, 3, 0).trimEnd().endsWith('</rdf:RDF>')).toBe(true);
    expect(capItems(feed, 3, 0).trimEnd().endsWith('</feed>')).toBe(true);
  });
});

describe('Atom 源（10 个真实源里没有）', () => {
  const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom Feed</title>
  <subtitle>atom 说明</subtitle>
  <link href="https://example.com/" rel="alternate"/>
  <entry>
    <title>Atom 上的一条</title>
    <link rel="alternate" href="https://example.com/post-1"/>
    <id>tag:example.com,2026:1</id>
    <updated>2026-09-17T10:00:00Z</updated>
    <summary>Atom 的摘要字段</summary>
    <content type="html">&lt;p&gt;Atom 的正文段落。&lt;/p&gt;</content>
  </entry>
</feed>`;

  it('能取到频道与条目，链接取 rel=alternate', () => {
    const ch = parseFeed(atom, src('article'));
    expect(ch).not.toBeNull();
    expect(ch!.title).toBe('Example Atom Feed');
    expect(ch!.items).toHaveLength(1);
    expect(firstOf(ch).url).toBe('https://example.com/post-1');
    expect(firstOf(ch).publishedAt).toBe('2026-09-17T10:00:00.000Z');
  });
});

describe('脏数据不抛错', () => {
  it('非订阅源内容返回 null', () => {
    expect(parseFeed('<html><body>404</body></html>', src())).toBeNull();
    expect(parseFeed('', src())).toBeNull();
  });

  it('Science 那种「enclosure 是图片」不算音频', () => {
    const rss = `<rss version="2.0"><channel><title>C</title><item>
      <title>paper</title><link>https://e.com/1</link><description>abstract</description>
      <enclosure url="https://e.com/img.jpg" length="87288" type="image/jpg"/>
    </item></channel></rss>`;
    const ch = parseFeed(rss, src('article'));
    expect(firstOf(ch).audio).toBeNull();
    expect(firstOf(ch).image).toBe('https://e.com/img.jpg');
  });

  it('CDATA 里的内容原样取出', () => {
    const rss = `<rss version="2.0"><channel><title>C</title><item>
      <title><![CDATA[CDATA 标题 & 符号]]></title><link>https://e.com/2</link>
      <description><![CDATA[<p>带 <b>标签</b> 的正文</p>]]></description>
    </item></channel></rss>`;
    const ch = parseFeed(rss, src('article'));
    expect(firstOf(ch).title).toBe('CDATA 标题 & 符号');
    expect(firstOf(ch).body).toBe('带 标签 的正文');
  });

  it('没有标题的条目被丢掉，而不是渲染成一堆空白行', () => {
    const rss = `<rss version="2.0"><channel><title>C</title>
      <item><title>A</title><link>https://e.com/1</link><description>x</description></item>
      <item><description>没有标题</description></item>
    </channel></rss>`;
    const ch = parseFeed(rss, src());
    expect(ch!.items).toHaveLength(1);
    expect(firstOf(ch).title).toBe('A');
  });
});
