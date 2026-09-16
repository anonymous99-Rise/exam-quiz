# 上线后的全面复查与修复（2026-09-16 轮）

> 目标：交付「完全可用、美观、无 bug」的产品级站点 → https://exam-quiz-seven.vercel.app
> 方法：线上真浏览器（Playwright + 真实 Chrome）逐模块实测 + 全站爬查，先复现再改，
>       每条结论都带证据；改完重跑全部门禁再部署。

## 一、本轮修掉的问题（6 个提交 / 8 类）

| # | 问题 | 证据 | 修法 |
| --- | --- | --- | --- |
| 1 | 缺音频时的提示被 `<audio>` 自身的 error 事件覆写成含糊的「音频播放出错」 | 线上实测提示文案 = 「音频播放出错·…」而非新写的缺失文案 | missingFile 在渲染期优先于 error（派生值兜住竞态） |
| 2 | 音源缺失时播放/进度/±10s/倍速仍可点，点了没反应；时长位永远挂「载入中…」 | 线上点击无反馈 | 控件禁用 + 时长位改「无音频」 |
| 3 | 冷启动慢被误报成「音频加载超时」，且元数据后来到了告警也不撤 | 部署后台实测 2020-07-1 报超时而音频其实正常（readyState 4 / 1612s） | 阈值 12s→20s；onMeta 拿到有限正时长时清 error |
| 4 | 12 套「部署包缺 mp3」的卷告知之后就没下文（用户听不到听力） | 12/12 线上探测：提示有了但播不了 | 自动切 assets 里的第三方 HLS 备用源（全部探活）；提示改 role=status 琥珀色；控件禁用条件改 noSource |
| 5 | 6 套 0 题的卷目录里写着「开始 →」；缺口说明沿用「仅能练习已收录部分」（实际一题未收） | 爬查 `/cet6` 卡片与详情页文案 | 改「查看 →」；flagHint 按 questionCount 消歧 |
| 6 | 4 处面包屑与页头主 `<nav>` 没有可访问名称；面包屑/页脚小链接命中区仅 15–19px（WCAG 2.5.8 要求 ≥24px） | 实测链接框 24×19 / 72×15 | 补 aria-label（命中区规则才作用得到）+ 绝对定位伪元素扩 6px |
| 7 | 无 favicon / 主屏图标 / manifest / robots（全部 404） | 逐个探测 | 补 app/icon.svg、apple-icon.png、manifest.ts、robots.ts |
| 8 | 校验器「跨套重复题干」10 条全是误报（选词填空 stem 是共用原文；听力题干天然复用） | 逐条比对该 10 条 | 改为「题干+选项」都一致才算重复；加 flag-consistency.mjs 交叉校验 |

## 二、线上实测结论（全部通过）

- **路由**：253 个真实路由（47 套 × 详情/模考/各板块 + 列表页）→ 247 正常；
  6 个「异常」全部是 0 题卷的 `/exam`，属「没有题就没有模考」的正确 404，页面无任何入口指向它。
- **听力**：30/30 可听。18 套第三方 HLS 原生可播（2020-07-1 实测 readyState 4 / 1612s / currentTime 前进）；
  12 套自托管 mp3 自动切备用源后可播（逐个实测，时长 1558–1708s，播放键可用）。
- **写作/翻译**：47/47 正常（textarea 就位、无 404、无 JS 报错）。
- **整卷模考**：55 题铺开、倒计时在走（129:57→129:55）、作答计数正确、答题卡 aria-modal、
  交卷出成绩报告、刷新后报告保持、交卷后作答冻结。
- **进度持久化**：答 1 题刷新后仍 1/25；localStorage `examquiz.progress.v1` version 3。
- **认证/同步**：`/api/auth/session` 200 null（未登录）、`/api/auth/providers` 200 github、
  `POST /api/sync` 未登录 401（不泄露）、`/api/sync/health` 200 healthy
  （syncEnabled/hasServiceKey/hasPgConn/authEnabled 全 true，ddl ok）。
- **墨迹层**：`pointer-events:none; z-index:5; position:fixed`，不挡答题（有墨迹层时点选项仍计数）。
- **移动端 375px**：首页/刷题/CET-6/听力/模考 5 页无横向溢出；本轮修掉小命中区。
- **代理边界**：路径穿越 `../../etc/passwd`、`cet6/97/../../../secret` 均 404；
  绝对 URL 不被转发；未知 id 返回干净 JSON 502；正常 m3u8 200。
- **题库体检**：0 error / 32 warning（全部是真缺口：6 处题号跳号 + 26 处原文缺尾段）；
  47 套 flags 与真实缺口 100% 一致（flag-consistency.mjs）。

## 三、门禁

`pnpm typecheck` 0 · `pnpm lint` 0 error（9 warning）· `pnpm test` 91 · `bank-validate` 0 error ·
`bank-roundtrip --exam cet6 --all` 47/47 · `pnpm build` 297 页 · `pnpm exec playwright test` 25/25

## 四、仍然存在的已知缺口（已如实标注给用户，未掩盖）

1. **22 套信息匹配题原文缺尾段**（源材料本身就没有）→ 答案 N/O 引用的段落不存在；
   flags 已含 `passage-truncated`，UI 有琥珀色提示。
2. **6 处题号跳号**（源材料缺题）→ flags 已含 `missing-nos`。
3. **6 套 0 题**（源材料未收录客观题）→ 目录标「暂无题目」，详情页说明只提供写作与翻译。
4. **音频仍依赖第三方 CDN**：12 套的自托管 mp3（267MB）因 gitignore+vercelignore 不在部署包里，
   现在走备用源（同一个第三方 CDN）。彻底自托管的两条路见第五节。
5. **CDN 上另有未映射的音频 id**（204/205/220/225 等）：无法可靠判定归属（时长 25–28 分钟彼此太近，
   不能作为判据），不猜。

## 五、彻底自托管音频（可选，需要用户参与一步）

现状可用，但 30 套听力都依赖 `listening.lazynote.cn`。要把 267MB mp3 搬到自己手里：

- **Supabase Storage（推荐）**：项目已建（kyiuxzttzybslxsnmmds），Vercel 里已有 service_role。
  把 service_role key 给我 → 本地直传（本机到 supabase.co 实测 1.7s 可达）→
  `node tools/assets-audio.mjs --base <公开桶地址>` 重指 assets.json → 部署。
- **进 git**：`+267MB` 仓库体积，两条部署路径都自带音频；最省事但会让仓库变重。
- 不搬也能用：现在的自动降级已经把「听不到」变成「能听到 + 如实告知来源」。
