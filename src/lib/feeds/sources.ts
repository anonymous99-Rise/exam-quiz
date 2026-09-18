import type { FeedSource } from './parse';

/**
 * 精选订阅源清单（听力播客 + 阅读文章）
 * ============================================================================
 * 只收录**亲手验过**的源：地址可达、结构可解析、内容稳定更新。
 * 每一条都写清「用它练什么」，避免变成随便堆链接的导航页。
 *
 * 实测记录（2026-09）：
 *   · VOA 的两个地址虽然长着 `/podcast/?zoneId=` 的样子，**返回的就是 RSS**
 *     （250 条、250 个音频 enclosure），不用再去找隐藏的 feed 地址。
 *   · BBC 的音频是 http://，解析时会升级成 https（否则 https 站点里被混合内容拦掉）。
 *   · Nature 是 **RSS 1.0 / RDF**（不是 2.0），条目靠 dc:date + content:encoded。
 *   · TED 的源 8.5MB / 2811 条，解析前要限量（见 parse.capItems）。
 */
export const FEED_SOURCES: FeedSource[] = [
  /* ── 听力：播客 ─────────────────────────────────────────────────────── */
  {
    id: 'voa-everyday',
    title: 'VOA Learning English · 每日英语',
    short: 'VOA 每日',
    kind: 'podcast',
    url: 'https://learningenglish.voanews.com/podcast/?zoneId=1689',
    homeUrl: 'https://learningenglish.voanews.com/',
    lang: 'en',
    genre: '慢速英语',
    note: '美音慢速节目，语速约为常速的三分之二，最适合精听的起点。',
  },
  {
    id: 'voa-grammar',
    title: 'VOA · Everyday Grammar',
    short: 'VOA 语法',
    kind: 'podcast',
    url: 'https://learningenglish.voanews.com/podcast/?zoneId=4456',
    homeUrl: 'https://learningenglish.voanews.com/',
    lang: 'en',
    genre: '语法',
    note: '用日常对话讲一个语法点，听完能直接对上真题里的语法题。',
  },
  {
    id: 'bbc-6min',
    title: 'BBC Learning English · 6 Minute English',
    short: '6 Minute',
    kind: 'podcast',
    url: 'https://podcasts.files.bbci.co.uk/p02pc9tn.rss',
    homeUrl: 'https://www.bbc.co.uk/learningenglish/english/features/6-minute-english',
    lang: 'en',
    genre: '英音 · 6 分钟',
    note: '每集 6 分钟聊一个话题，英音，长度刚好适合通勤时精听一遍。',
  },
  {
    id: 'eslpod',
    title: 'ESLPod · Speak English with ESLPod',
    short: 'ESLPod',
    kind: 'podcast',
    url: 'https://www.eslpod.com/feed.xml',
    homeUrl: 'https://www.eslpod.com/',
    lang: 'en',
    genre: '教学播客',
    note: '为英语学习者做的节目：先慢速讲解词汇与句型，再用常速对话，精听入门最省力。',
  },
  {
    id: 'npr-upfirst',
    title: 'NPR · Up First',
    short: 'NPR',
    kind: 'podcast',
    url: 'https://feeds.npr.org/510318/podcast.xml',
    homeUrl: 'https://www.npr.org/podcasts/510318/up-first',
    lang: 'en',
    genre: '新闻 · 10 分钟',
    note: '每天早上 10 分钟讲三条要闻，语速接近常速、题材固定，泛听练新闻词汇最合适。',
  },
  {
    id: 'librivox',
    title: 'LibriVox 有声书（公共领域）',
    short: '有声书',
    kind: 'podcast',
    // 列表是 JSON（不含章节），章节走每本书的 RSS —— 见 librivox.ts
    url: 'https://librivox.org/api/feed/audiobooks?format=json&language=en&limit=6',
    homeUrl: 'https://librivox.org/',
    lang: 'en',
    genre: '有声书 · 长时段',
    note: '公版英文有声书（狄更斯、大仲马、奥斯汀…），单章 15–40 分钟，适合长时段泛听。',
    format: 'librivox',
  },
  {
    id: 'bbc-discovery',
    title: 'BBC World Service · Discovery',
    short: 'Discovery',
    kind: 'podcast',
    url: 'https://podcasts.files.bbci.co.uk/p002w557.rss',
    homeUrl: 'https://www.bbc.co.uk/programmes/p002w557',
    lang: 'en',
    genre: '科普纪录片',
    note: '科学家访谈式科普，语速与术语密度接近六级听力长对话的上限。',
  },
  {
    id: 'ted-daily',
    title: 'TED Talks Daily',
    short: 'TED',
    kind: 'podcast',
    url: 'https://feeds.acast.com/public/shows/67587e77c705e441797aff96',
    homeUrl: 'https://www.ted.com/podcasts/ted-talks-daily',
    lang: 'en',
    genre: '演讲',
    note: '每天一集演讲，练的是观点表达与逻辑连接词（写作也能用）。',
  },

  /* ── 阅读：RSS ─────────────────────────────────────────────────────── */
  {
    id: 'chinadaily',
    title: 'China Daily',
    short: 'China Daily',
    kind: 'article',
    url: 'https://feedx.net/rss/chinadaily.xml',
    homeUrl: 'https://www.chinadaily.com.cn/',
    lang: 'en',
    genre: '中国新闻（英文）',
    note: '讲中国事务的英文标杆：时政、经济类词汇与固定搭配最集中。',
  },
  {
    id: 'bbc-news',
    title: 'BBC 中文网',
    short: 'BBC 中文',
    kind: 'article',
    url: 'https://feedx.net/rss/bbc.xml',
    homeUrl: 'https://www.bbc.com/zhongwen/simp',
    lang: 'zh',
    genre: '国际新闻',
    note: '中文报道国际时事，用来快速补齐新闻背景，再读英文版更省力。',
  },
  {
    id: 'sciencedaily',
    title: 'ScienceDaily',
    short: 'ScienceDaily',
    kind: 'article',
    url: 'https://www.sciencedaily.com/rss/all.xml',
    homeUrl: 'https://www.sciencedaily.com/',
    lang: 'en',
    genre: '科普',
    note: '句子短、术语重复率高，是精读练学术词汇性价比最高的一档。',
  },
  {
    id: 'science',
    title: 'Science（AAAS）',
    short: 'Science',
    kind: 'article',
    url: 'https://feeds.science.org/rss/science.xml',
    homeUrl: 'https://www.science.org/',
    lang: 'en',
    genre: '学术新闻',
    note: '《Science》新闻版，摘要式报道，可直接当学术写作范本抄结构。',
  },
  {
    id: 'nature',
    title: 'Nature',
    short: 'Nature',
    kind: 'article',
    url: 'https://www.nature.com/nature.rss',
    homeUrl: 'https://www.nature.com/',
    lang: 'en',
    genre: '学术论文',
    note: '每期论文摘要（RSS 1.0 格式），长难句密度最高，适合冲高分时读。',
  },
];

export const PODCAST_SOURCES = FEED_SOURCES.filter((s) => s.kind === 'podcast');
export const ARTICLE_SOURCES = FEED_SOURCES.filter((s) => s.kind === 'article');

export function sourceById(id: string): FeedSource | undefined {
  return FEED_SOURCES.find((s) => s.id === id);
}
