# exam-quiz · 英语考试刷题站

多考试、题库可丝滑导入的真题刷题站。首个版本覆盖 **CET-6 全量历史 + CET-4 全量可用年份**。

> 设计定稿见 [`docs/DESIGN.md`](docs/DESIGN.md) —— 实现与该文件冲突时，先改文件再改代码。

## 状态

| | |
|---|---|
| 阶段 | **M0–M8 完成，M7（登录+云同步）完成**；CET-6 已入库 47 套（46 旧站 + 2018-06-1 抽取），M10b 继续补 2013–2019 |
| 技术栈 | Next.js 16 (App Router) · TypeScript · Tailwind v4 · Zod · Zustand · Auth.js v5 · Supabase |
| 部署 | Vercel（`vercel --prod`） |
| 认证 | GitHub OAuth，**匿名可完整使用**（不登录只少了跨设备同步） |
| 进度存储 | localStorage 为准，登录后与 Supabase 逐条合并（规则见 `src/lib/sync/merge.ts`） |
| 音频 | 30 套走第三方 HLS（`listening.lazynote.cn`，可热切换）；12 套引用本地 mp3，**待 M9 迁到 Supabase Storage** |

## 部署（Vercel + Supabase）

站点在**没有任何环境变量**时也能完整部署运行 —— 只是退化为「本地模式」：
导航不显示登录入口、不请求 `/api/sync`、进度只存在浏览器里。

要开启登录与云同步，配齐下面这些环境变量即可（Vercel 项目 Settings → Environment Variables）：

| 变量 | 说明 |
|---|---|
| `AUTH_SECRET` | 会话签名密钥，`openssl rand -base64 32` 生成 |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | GitHub OAuth App 的 Client ID / secret |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL（Vercel 集成会自动注入 `SUPABASE_URL`，两者都认） |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role secret，**仅服务端使用** |

GitHub OAuth App 的回调地址（Authorization callback URL）填：

```
https://<你的域名>/api/auth/callback/github
```

Supabase 侧只需建一张表（`supabase/schema.sql`）：

```bash
# 方式一：Supabase 控制台 → SQL Editor → 粘贴 supabase/schema.sql
# 方式二：用连接串直连执行
node tools/supabase-init.mjs
```

本地开发同理：`cp .env.example .env.local` 后填值；回调地址再加一条
`http://localhost:3000/api/auth/callback/github`。

## 体量规划

| 考试 | 套数 | 来源 |
|---|---|---|
| CET-6 | 85 | 46 套来自旧站结构化数据 + 39 套从素材库抽取 |
| CET-4 | 39 | 全部从素材库抽取 |
| **合计** | **124 套** | |

## 目录

```
src/          Next.js 应用（app / components / lib / server）
content/      题库单一真源（纯文本入 git）
tools/        导入 / 抽取 / 校验脚本
docs/         设计与素材报告
.sources/     原始素材（gitignore）
```

## 素材与工具

原始素材来自 [YinsinSirius/CET6-Resources](https://github.com/YinsinSirius/CET6-Resources)
（1.2GB，PDF 走 Git LFS）。

```bash
# 1) 克隆素材（必须跳过 LFS smudge，否则拿到的是 131 字节指针）
GIT_LFS_SKIP_SMUDGE=1 git clone \
  https://github.com/YinsinSirius/CET6-Resources.git .sources/CET6-Resources

# 2) 拉取全部实体 PDF —— 解析与真题都在 LFS 里，一个都不能少
cd .sources/CET6-Resources && git lfs pull && git fetch --unshallow

# 3) 生成素材覆盖矩阵 / PDF 文本层探测报告
cd ../.. && node tools/inventory.mjs
node tools/pdf-probe.mjs --pages 6
```

**本地素材已拉全**：217 / 217 个 PDF 实体化（指针残留 0）、LFS 对象 1,246 MB、
工作区 1,557 MB、`--unshallow` 完成（8 commits / 3 branches）、`.git` 2,333 MB。

生成的报告：

| 文件 | 内容 |
|---|---|
| `docs/inventory.md` / `.json` | 每个考期的文件构成、套数、LFS 占比、音频 |
| `docs/pdf-textability.md` / `.json` | 每个 PDF 是文本版还是扫描图片版 |

## 已知硬约束

- **217 个 PDF 全部是 Git LFS**（1.24 GB）：不 `git lfs pull` 就没有解析。
- **约 19% 的 PDF 是扫描图片**，`pdftotext` 抽出 0 字，抽取必须走双路管线。
  实测：真题 94 text / 3 sparse / 12 scanned，解析 70 text / 8 sparse / 30 scanned。
  分界明细见 `docs/pdf-textability.md`。
- **要新增的 78 套里约 69% 可直接抽**（CET-6 8 个考期 + CET-4 10 个考期），
  其余需 OCR；CET-6 2022.12 / 2023.06 / 2024.12 / 2025.06 虽是扫描件，
  但旧站 S1 已有结构化数据，不必 OCR。
- **CET-4 缺 2020–2023**：素材库真断档，界面如实呈现，不补假数据。
- 第三方 HLS 听力源（`listening.lazynote.cn`）**不写死**，走 `assets.json` 可热切换；
  素材库自带的 12 个 mp3（299 MB）可替换其中 6 个 CET-6 考期的音源。

## 版权

题库整理自全国大学英语四、六级考试真题及配套解析，版权归原命题方所有。
本站定位为**个人备考练习工具**，不用于商业用途、不再分发原始材料。
默认 `robots: noindex`，不加入公开索引。
