/**
 * 订阅源解析 —— 真样本回归
 *
 * tmp/feeds 下是各源实抓的原始响应（gitignore，不随仓库分发）。本地有样本时就跑，
 * 没有就整体跳过（CI 里不会因此变红）。这一层比合成用例重要得多：
 * 三个格式（RSS 2.0 / RSS 1.0 RDF / Atom）、时区缩写、三种时长写法、
 * enclosure 里混着图片 —— 都是从这些真样本里发现的。
 *
 * 重新抓样本的命令见 docs/FEEDS-MODULE.md。
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseFeed } from './parse';
import { FEED_SOURCES } from './sources';

const FILE: Record<string, string> = {
  'voa-everyday': 'raw-voa-everyday-page.bin',
  'voa-grammar': 'raw-voa-grammar-page.bin',
  'bbc-6min': 'bbc-6min.xml',
  'bbc-discovery': 'bbc-discovery.xml',
  'ted-daily': 'ted-daily.xml',
  'eslpod': 'eslpod.xml',
  'npr-upfirst': 'npr-510318.xml',
  chinadaily: 'raw-chinadaily.bin',
  'bbc-news': 'raw-bbc-news.bin',
  sciencedaily: 'sciencedaily.xml',
  science: 'science.xml',
  nature: 'nature.xml',
};

const dir = 'tmp/feeds';
const available = fs.existsSync(dir) ? fs.readdirSync(dir) : [];

describe('真样本回归（tmp/feeds 存在时）', () => {
  for (const src of FEED_SOURCES) {
    const file = FILE[src.id];
    const path = `${dir}/${file}`;
    const has = file && available.includes(file);

    it.skipIf(!has)(`${src.id} 能解析出条目`, () => {
      const xml = fs.readFileSync(path, 'utf8');
      const ch = parseFeed(xml, src);
      expect(ch, `${src.id} 结构应可识别`).not.toBeNull();
      expect(ch!.items.length).toBeGreaterThan(0);

      const first = ch!.items[0];
      expect(first, `${src.id} 应有条目`).toBeDefined();
      if (!first) return;
      expect(first.title.length).toBeGreaterThan(2);
      expect(first.url).toMatch(/^https?:\/\//);
      expect(first.publishedAt).toBeTruthy();
      expect(Number.isNaN(Date.parse(first.publishedAt!))).toBe(false);

      // 播客源必须有音频，且不能是 http（混合内容）
      if (src.kind === 'podcast') {
        const withAudio = ch!.items.filter((i) => i.audio);
        expect(withAudio.length, `${src.id} 应有音频条目`).toBeGreaterThan(0);
        for (const i of withAudio.slice(0, 5)) {
          expect(i.audio!.url.startsWith('https://'), `${i.title} 的音频必须是 https`).toBe(true);
        }
      }

      // 文章源必须有正文/摘要
      if (src.kind === 'article') {
        const withBody = ch!.items.filter((i) => i.body.length > 20);
        expect(withBody.length, `${src.id} 应有正文或摘要`).toBeGreaterThan(0);
        // 正文里不该残留标签
        expect(first.body).not.toMatch(/<\/(p|div|html)>/i);
      }

      console.log(
        `  ${src.id.padEnd(14)} ${ch!.items.length} 条 · 首条「${first.title.slice(0, 46)}」· ${first.publishedAt} · 音频 ${
          first.audio ? `${Math.round((first.audio.bytes ?? 0) / 1024 / 1024)}MB/${first.audio.durationSec}s` : '无'
        } · 正文 ${first.body.length} 字`,
      );
    });
  }
});
