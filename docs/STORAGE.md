# 存储与部署包（Storage Layout）

> 记录本站每类资产**放在哪、为什么、多大、怎么取**，以及 Vercel 部署存储的清理办法。
> 起因：Vercel 部署存储一度涨到 **11.66GB**（免费额度 100GB，但翻倍涨很吓人）。
> 结论：**不是被谁占了，而是 74 次生产部署 × 每次约 200–270MB 累加出来的**。

---

## 1. 资产分布（实测值）

| 资产 | 位置 | 体积 | 站点取数路径 |
| --- | --- | --- | --- |
| CET-6 听力 mp3（12 套） | **Supabase Storage** `audio/` | 声明合计 232.0MB | `/api/audio/[...path]`（允许名单代理）→ 播放器 / `/api/media` 兜底 |
| HLS 备用音源（18 条） | 第三方 `listening.lazynote.cn` | 站外 | 直连（`content/cet6/assets.json` 内） |
| 词汇数据（137 文件） | **Vercel Blob**（私有 store） | 60.1MB | `/api/vocab-data/[...path]`（服务端带 token 读，同源 + 长缓存） |
| 真题正文 / 题库 JSON | 仓库 `content/` | 约 9.5MB | 构建期读入，进静态页 |
| 部署构建产物 | Vercel（每次部署一份） | `.next` ≈ 252MB（`cache` 131.5 + `server` 117.6） | — |
| 仓库跟踪文件 | GitHub | **11.3MB**（清理前 71.3MB） | — |

免费额度对照：Supabase Free = **1GB 存储 / 10GB 月流量**（DB+Storage+Functions 共享，单文件上限 50MB）；
Vercel Blob 与部署存储各自计费。当前音频 232MB + 词汇 60MB，都在免费档内。

## 2. 11.66GB 是怎么来的

```
74 次生产部署
  × ( 仓库源 134MB 音频 + 60MB data/vocab + 60MB 生成副本 public/vocab-data + 构建产物 )
  ≈ 十几 GB
```

三个放大器，都已拆掉：

1. **134MB mp3 曾直接提交进仓库**（`public/audio/cet6-2024-12-1.mp3` 等）→ 已删除文件并改为对象存储；
2. **`data/vocab`（60MB）曾提交进仓库** → 已移出索引，只留 `data/vocab-manifest.json`；
3. **`prebuild` 曾把 60MB 复制进 `public/vocab-data`** → 已移除该 prebuild 与目录。

## 3. 为什么资产不直接放 `public/`

- **私有 store 不能公开读**：Blob store 为 private 时，公开读会报
  `Cannot use public access on a private store`；由服务端带 token 读既可用，也不用放宽 store 权限。
- **可达性**：Supabase 域名在本机线路下 `ENOTFOUND` / `ECONNRESET` 交替出现（Node fetch 不吃 Windows 系统代理，
  需要 `HTTPS_PROXY` + `NODE_USE_ENV_PROXY=1`）；浏览器 fetch 一旦失败就是白屏。
  所以浏览器要取的数据一律走**自己的域名 + CDN 缓存**（`s-maxage=31536000`，每个分片只真正回源一次）。
- **部署包体积**：仓库里放一份 = 每次部署都背一份。

## 4. 清理与日常维护

```powershell
# 部署清理（默认干跑，只列表；加 --delete 真删）
node tools/vercel-prune.mjs                 # 列出可删的旧部署
node tools/vercel-prune.mjs --delete        # 执行删除

# 词汇数据：仓库里没有本体，需要本地跑工具链时取回
pnpm vocab:pull                             # 按 data/vocab-manifest.json 从 Blob 拉回 data/vocab/
pnpm vocab:pull --write-manifest            # 反向：按本地目录重写清单

# 词汇数据上传（改完词汇后：生成 → 上传）
pnpm vocab:upload
```

**Vercel 部署保留策略**（Dashboard → Settings → Deployment Retention）：
当前为 *Production 7 天 / 其余 1 天*。本项目是「push 即部署」的节奏，
生产部署就是近期构建的连续副本，建议 **Production 收紧到 1–3 天**，其余保持 1 天。

## 5. 验证入口

```powershell
# 同源代理是否活着（线上）
curl.exe -s -o NUL -w "%{http_code}\n" https://exam-quiz-seven.vercel.app/api/vocab-data/index.json

# 页面级验收（本地 3105 或线上别名）
node tools/verify-vocab-proxy.mjs http://127.0.0.1:3105
node tools/verify-vocab-proxy.mjs https://exam-quiz-seven.vercel.app
```

验收标准：`/vocab` 出现 7 本词书、`/vocab/cet6` 每页 50 条共 114 页、
学习页能取到分片 `s01.json`、白名单外路径返回 404。
