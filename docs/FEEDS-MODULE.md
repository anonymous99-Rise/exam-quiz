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
| ESLPod | RSS 2.0 + iTunes | 11（滚动） | ✅ | 时长 `30:41`；面向学习者的讲解式节目 |
| NPR · Up First | RSS 2.0 + iTunes | 500 | ✅ | 音频地址是 `prfx.byspotify.com` 的**跳转链接**（会 302 到真源） |
| LibriVox 有声书 | **JSON 列表 + 每本书的 RSS** | 6 本书 × 前 6 章 | ✅ | 列表接口**不含章节**，章节走 `url_rss`；见坑 5 |
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
5. **LibriVox 的列表接口不含章节**。`/api/feed/audiobooks?format=json` 只给书名与
   `num_sections`，章节要另外取；实测两条路都通：`?id=47&extended=1`（JSON）与
   `https://librivox.org/rss/47`（**标准 RSS 2.0**）。这里走后者 —— 标准格式能直接复用
   `parseFeed`，少一套会坏的解析。代价是 1 + N 次请求，所以并发限 3（见下）。
   另：时长字段名是 `totaltimesecs`（**无下划线**），另一个 `totaltime` 是 `49:43:15` 字符串。

另外两条工程要求：

- **解析前限量**：TED 的源 8.5MB / 2811 条，全量解析在 serverless 上是纯浪费。
  `capItems()` 先按标签边界切到前 30 条再解析（切点落在标签之间，补根闭合标签即可）。
- **先解实体再剥标签**：feedx 把整段 HTML 实体转义后塞进 description，
  顺序写反会让标签原样留在正文里（样本回归里挂了两个源才发现）。
- **失败重试一次 + 并发限流**：实测两次构建期「偶发单源失败」（feedx 的 BBC 中文、
  每日一句接口），单独复测都是 200。现在每个请求失败后重试一次（300ms 退避），
  LibriVox 的逐书请求并发限 3 —— 否则 8 个节目 + 7 个 LibriVox 请求会在同一瞬间
  铺开，把出口（尤其是代理后面）打满，表现为「某几个源随机失败」。

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

## 五、本地开发：先解决「Node 不走系统代理」这件事

**症状**：浏览器能开 BBC/VOA，PowerShell `Invoke-WebRequest` 也能取到，
但**本项目的 `pnpm dev` / `pnpm build` 取不到**（`UND_ERR_CONNECT_TIMEOUT` / ECONNRESET）。

**根因**（已实测确认，和 Clash 无关）：

| 客户端 | 读 Windows 系统代理（注册表 `Internet Settings`） | 读 `HTTPS_PROXY` 环境变量 | 结果 |
| --- | --- | --- | --- |
| PowerShell / .NET（`Invoke-WebRequest`） | ✅ 自动 | — | 走代理，通 |
| **Node 的 `fetch`（undici）** | ❌ **完全不读** | ✅ 但需 `NODE_USE_ENV_PROXY=1` | 直连，被墙 |
| `curl.exe` | ❌ | ✅ | 直连（未设变量时），不通 |

Clash Verge 打开的是**系统代理**（`ProxyEnable=1`、`ProxyServer=127.0.0.1:7897`），
它不会设环境变量；所以只有 .NET 系自动走了代理。

实测证据：

```
直连                         → UND_ERR_CONNECT_TIMEOUT（10.7s）
HTTPS_PROXY=http://127.0.0.1:7897 + NODE_USE_ENV_PROXY=1
                             → 200，815KB，967ms
```

**本机（及任何用 Clash 的开发机）跑项目的正确姿势**：

```powershell
$env:HTTPS_PROXY='http://127.0.0.1:7897'   # 换成你自己的混合端口
$env:HTTP_PROXY='http://127.0.0.1:7897'
$env:NODE_USE_ENV_PROXY='1'                # Node 24 起需要显式打开
pnpm dev        # 或 pnpm build && pnpm start
```

生产（Vercel）不需要代理，直连即可。

**离线兜底**：若确实没有网络，可用抓好的样本当上游（dev-only）：

```powershell
# 抓样本（PowerShell 能通）
$ua='Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36'
Invoke-WebRequest 'https://podcasts.files.bbci.co.uk/p02pc9tn.rss' -Headers @{'User-Agent'=$ua} -OutFile tmp/feeds/bbc-6min.xml
# …文件名见 src/lib/feeds/api.ts 的 localSample()

$env:FEEDS_LOCAL_DIR='tmp/feeds'; pnpm dev
```

## 六、阅读页的沉浸式划词翻译（/api/translate）

阅读时最频繁的动作是「这句我看不懂」。所以正文区**选中即出结果**，不切页面：

| 选区 | 就地结果 | 跳转入口 |
| --- | --- | --- |
| 单词（≤24 字符） | 中文词义 | 「词典释义 ↗」 |
| 短语 / 整句 / 整段（最长 400 字） | 中文整句译文 | 「有道翻译 ↗」 |
| 任意选区 | — | 「朗读」（有道返回的译文 mp3）、「复制」 |

实现要点：

- **中文不能按空格判档**：`认知弹性有助于预测老年痴呆症。` 没有空格但是一整句，
  所以中文按字符数（≤4 字当词、≤12 字当短语），英文才用词数。
- **两个上游**：有道 `aidemo.youdao.com/trans`（实测 ~300ms，词/句/中英双向都行，
  还带译文朗读地址）→ 失败则退到 MyMemory。两者都挂时浮层仍保留「有道 ↗」，
  不会变成死胡同。
  （注：老的无鉴权端点 `fanyi.youdao.com/translate?doctype=json` **已失效**，现在返回 SPA 页面。）
- **服务端代理 + CDN 缓存**：上游无 CORS 头，且译文是稳定的 ——
  `/api/translate` 带 `s-maxage=86400`，同一段文字只有第一次真的打到上游。
- **只认最后一次结果**：连划两次时用自增序号丢弃过期响应，
  否则会出现「划了新句子、显示上一句译文」（纯逻辑在 `selection.ts`，有单测钉住）。

## 七、测试

```powershell
pnpm exec vitest run src/lib/feeds            # 单测（含划词翻译纯逻辑）
pnpm exec playwright test e2e/feeds.spec.ts   # 9 个端到端
```

- `parse.sample.test.ts`：**真样本回归**（`tmp/feeds` 存在才跑，不存在整体跳过）。
  三个格式、时区缩写、三种时长、http 升级、每条正文不含残留标签 —— 都在这里钉住。
- `parse.test.ts`：合成用例补真样本没有的情况（Atom、限量截断、CDATA、脏数据）。
- `librivox.test.ts`：JSON 列表归一化 + 每本书 RSS 复用解析器。
- `selection.test.ts`：划词档位判定、有道/MyMemory 响应解析（含把限流文案判成失败）。
- `e2e/feeds.spec.ts`：结构与交互（含划词翻译，翻译接口被 mock）；
  **「有内容才断言交互」**（构建机网络受限时不假装功能坏了）。

## 八、维护

- 换源 / 加源：只改 `src/lib/feeds/sources.ts`，UI 自动跟随（列表、筛选、统计都是从它推导的）。
- 上游改版：先 `curl` 看原始结构，再只改 `parse.ts` 的字段映射；
  `parse.sample.test.ts` 会立刻告诉你哪一条坏了。
- 音频打不开：先确认是不是又被改回 `http://`（坑 1），再看该 CDN 在当前网络是否可达 ——
  播放条会显示「这一集的音频没取到」并给出节目页与重试入口，不会静默失败。

## 九、还没做的（有意留白）

- **逐句跟读 / 字幕**：需要把音频时间轴与文本对齐，属于下一期（可先用 VOA 的文本稿）。
- **生词本落库**：现在划词是「就地出译文 + 一键有道」；
  若要「划一下即入词库」，需要构建期生成一份词库索引（约 100KB）并接到词汇模块的进度库。
- **离线缓存**：PWA 缓存最近几集音频是下一个体验台阶（当前只做了 On-demand ISR）。
