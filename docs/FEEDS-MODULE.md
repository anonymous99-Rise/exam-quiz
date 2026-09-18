# 听读模块（/listen · /read）

> 代码：`src/lib/feeds/*` · `src/components/feeds/*` · `src/app/listen|read/page.tsx`
> 订阅源清单：`src/lib/feeds/sources.ts`（10 个源，全部实测过）

## 一、为什么是「听力 + 阅读」两个模块

真题刷题解决的是「考试分数」，但听力和阅读能力的天花板取决于**真实语料的输入量**。
这两个模块就是那个输入的入口：

| 模块 | 路径 | 做什么 | 练什么 |
| --- | --- | --- | --- |
| 听力 | `/listen` | 5 个真实播客（VOA ×2 / BBC ×2 / TED），可变速、15 秒回退、断点续听 | 精听（0.75×）与提速（1.25×） |
| 阅读 | `/read` | 5 个订阅源（China Daily / BBC 中文 / ScienceDaily / Science / Nature），68ch 栏宽、三档字号、选中即查词 | 精读长难句、积累学术与新闻词汇 |

两页都是**服务端取好数据 + ISR**（听力 30 分钟、阅读 30 分钟再验证），
首屏没有加载态；上游抖动时构建产物就是兜底缓存。

## 二、订阅源实测形态（决定了解析器怎么写）

| 源 | 格式 | 条目 | 音频 | 备注 |
| --- | --- | --- | --- | --- |
| VOA 每日英语 `podcast/?zoneId=1689` | RSS 2.0 | 250 | ✅ 28MB/集 | **页面地址本身就是 RSS**，不需要再找隐藏 feed |
| VOA Everyday Grammar `zoneId=4456` | RSS 2.0 | 250 | ✅ | 同上 |
| BBC 6 Minute English | RSS 2.0 + iTunes | 341 | ✅ **http://** | 时长是纯秒（`381`） |
| BBC Discovery | RSS 2.0 + iTunes | 853 | ✅ **http://** | 每集时长约 26 分钟 |
| TED Talks Daily（acast） | RSS 2.0 + iTunes | **2811**（8.5MB） | ✅ | 时长是 `21:42`，解析前必须限量 |
| China Daily（feedx 镜像） | RSS 2.0 | 80 | — | description 是**实体转义的整段 HTML** |
| BBC 中文（feedx 镜像） | RSS 2.0 | 20 | — | 同上；正文 3–4k 字，适合精读 |
| ScienceDaily | RSS 2.0 | 60 | — | 日期带**时区缩写 EDT** |
| Science（AAAS） | RSS 2.0 | 30 | —（enclosure 是配图） | `type="image/jpg"` |
| Nature | **RSS 1.0 / RDF** | 75 | — | 用 `dc:date` + `content:encoded` |

## 三、解析器的四个坑（都有测试钉住）

`src/lib/feeds/parse.ts` 是手写扫描器（不引 XML 依赖，理由见文件头注释）。四个坑都是实测出来的：

1. **BBC 的音频是 `http://`**。站点是 https，浏览器按混合内容直接拦掉，播放器一点反应都没有。
   → 解析时对白名单主机升级协议（实测升级后 206 + `Content-Range`，可正常拖动）。
   **刻意不做媒体代理**：serverless 响应体有 4.5MB 上限，而播客单集 20–28MB；
   让浏览器直连 CDN 既避开上限又省流量。
2. **`Date.parse('… EDT')` 不可靠**（时区缩写不是规范的一部分）。ScienceDaily 全站都是这个写法。
   → 自建时区表（EDT/EST/GMT/CET/IST…），查不到就按 UTC 处理 —— 宁可差几小时，也别整条丢掉。
3. **时长三种写法**：`381`（秒）/ `21:42` / `1:02:03`。→ `parseDuration` 三种都认。
4. **enclosure 不一定音频**：Science 的 enclosure 是 `type="image/jpg"` 的配图。
   → 只认 `type^=audio/` 或 `medium="audio"`；图片进 `image` 字段。

另外两条工程要求：

- **解析前限量**：TED 的源 8.5MB / 2811 条，全量解析在 serverless 上是纯浪费。
  `capItems()` 先按标签边界切到前 30 条再解析（切点落在标签之间，补根闭合标签即可）。
- **先解实体再剥标签**：feedx 把整段 HTML 实体转义后塞进 description，
  顺序写反会让标签原样留在正文里（样本回归里挂了两个源才发现）。

## 四、架构边界（踩过一次构建失败）

```
浏览器 ─► /listen（ISR 30m）─ 服务端 fetch 5 个播客源 → parseFeed → 客户端播放
浏览器 ─► /read  （ISR 30m）─ 服务端 fetch 5 个文章源 → parseFeed → 客户端阅读
        （音频由浏览器直连 CDN；没有媒体代理，也没有 /api/feeds）
```

**`node:fs` 绝不能被客户端组件间接引到**。给「本地样本兜底」在 `api.ts` 里加了
`import fs`，而客户端组件当时从 `api.ts` 引 `formatDuration` —— 构建直接报
`the chunking context does not support external modules (request: node:fs)`。
所以纯函数全部搬到 **`src/lib/feeds/format.ts`**（零服务端依赖）。
以后凡是客户端要用的函数，都不许放在会 `import fs` 的模块里。

## 五、本地开发：用样本文件当上游

本机（国内网络 + 安全套件）对 BBC / VOA / acast / feedx 的直连会被 ECONNRESET 或超时，
而 Vercel 上的函数能正常取到。为让本地能看到真实页面，加了一个 **dev-only** 兜底：

```powershell
# 1) 抓样本（PowerShell 能通，Node 直连会被拦）
$ua='Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36'
Invoke-WebRequest 'https://learningenglish.voanews.com/podcast/?zoneId=1689' -Headers @{'User-Agent'=$ua} -OutFile tmp/feeds/raw-voa-everyday-page.bin
Invoke-WebRequest 'https://podcasts.files.bbci.co.uk/p02pc9tn.rss'          -Headers @{'User-Agent'=$ua} -OutFile tmp/feeds/bbc-6min.xml
# …其余源同理，文件名见 src/lib/feeds/api.ts 的 localSample()

# 2) 用样本构建/启动
$env:FEEDS_LOCAL_DIR='tmp/feeds'; pnpm dev      # 或 pnpm build && pnpm start
```

生产不设这个变量，走的仍是真实网络。

## 六、测试

```powershell
pnpm exec vitest run src/lib/feeds          # 34 个单测
pnpm exec playwright test e2e/feeds.spec.ts # 8 个端到端
```

- `parse.sample.test.ts`：**真样本回归**（`tmp/feeds` 存在才跑，不存在整体跳过）。
  三个格式、时区缩写、三种时长、http 升级、每条正文不含残留标签 —— 都在这里钉住。
- `parse.test.ts`：合成用例补真样本没有的情况（Atom、限量截断、CDATA、脏数据）。
- `e2e/feeds.spec.ts`：结构与交互；**「有内容才断言交互」**（构建机网络受限时不假装功能坏了）。

## 七、维护

- 换源 / 加源：只改 `src/lib/feeds/sources.ts`，UI 自动跟随（列表、筛选、统计都是从它推导的）。
- 上游改版：先 `curl` 看原始结构，再只改 `parse.ts` 的字段映射；
  `parse.sample.test.ts` 会立刻告诉你哪一条坏了。
- 音频打不开：先确认是不是又被改回 `http://`（坑 1），再看该 CDN 在当前网络是否可达 ——
  播放条会显示「这一集的音频没取到」并给出节目页与重试入口，不会静默失败。

## 八、还没做的（有意留白）

- **逐句跟读 / 字幕**：需要把音频时间轴与文本对齐，属于下一期（可先用 VOA 的文本稿）。
- **生词本落库**：阅读页现在用「选中 → 有道释义 / 复制」解决即时查词；
  若要「选中即入词库」，需要构建期生成一份词库索引（约 100KB）并接到词汇模块的进度库。
- **离线缓存**：PWA 缓存最近几集音频是下一个体验台阶（当前只做了 On-demand ISR）。
