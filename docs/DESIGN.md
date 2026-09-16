# exam-quiz · 定稿方案

> 目标：把 `D:\blog\cet6-exam-quiz`（原生 JS 静态站，CET-6 46 套 / 1859 题）重做成一个
> **多考试、题库可丝滑导入** 的 Next.js 站点，首版覆盖 CET-6 全量历史 + CET-4 全量可用年份。
>
> 状态：**待开工**（本文档为唯一设计真源，实现与本文件冲突时改本文件）

---

## 0. 决策快照

| 项 | 决定 | 备注 |
|---|---|---|
| 部署 | **Vercel** | Node runtime，无自建服务器 |
| 数据库 | **Supabase Postgres** | 只存 user / progress / fav / wrong / draft |
| 认证 | **Auth.js (NextAuth v5) + GitHub OAuth** | **匿名可完整使用**，登录仅解锁跨设备同步 |
| 题库 | **静态内容**（`content/` 纯文本入 git） | 题库进不了数据库，构建期生成 registry |
| 大文件资产 | **Supabase Storage** | PDF / MP3 不入 git |
| 导入器 | **半自动：文档抽取 → 候选区 → 过闸入库** | L1 全自动 / L2·L3 人工过闸 |
| 素材范围 | **全部覆盖到位** | CET-6 2013–2026 + CET-4 全量 |
| 新目录 | `D:\blog\exam-quiz` | 旧站 `D:\blog\cet6-exam-quiz` 保持不动，仅作数据来源 |
| 技术栈 | Next.js 16 App Router · TS 6.0.3 · Tailwind v4 · Zod 4 · Zustand 5 · Auth.js · Supabase | |
| 功能范围 | 与旧站**全量对等 + 增量** | 含透明手写模块、HLS 听力、主观题；增量：原卷 PDF 下载、MP3 播放、多考试 |

---

## 0.1 工具链版本锁定（M0 实测踩坑记录）

`pnpm add <pkg>` 会装到 npm `latest`，而当前生态里**有三个包的最新版互相不兼容**。
不要"升级到最新"，按下面锁：

| 包 | 锁定版本 | 为什么 | npm latest |
|---|---|---|---|
| `next` | 16.3.5 | 无冲突，可用最新 | 16.3.5 |
| `typescript` | **6.0.3** | `typescript-eslint@8.70` 的 peer 是 `>=4.8.4 <6.1.0`；TS 7 是原生重写版，会直接抛 `typescript-eslint does not support TS 7.0` | 7.0.2 |
| `eslint` | **9.39.5** | `eslint-plugin-react@7.37.5`（被 `eslint-config-next` 依赖）的 peer 只到 `^9.7`；ESLint 10 会抛 `contextOrFilename.getFilename is not a function` | 10.10.0 |
| `react` / `react-dom` | 19.3.0 | 无冲突 | 19.3.0 |
| `zod` | 4.6.5 | 用 Zod 4 语法（`z.record` 需显式 key/value 类型） | 4.6.5 |
| `zustand` | 5.0.15 | 无冲突 | 5.0.15 |
| `tailwindcss` / `@tailwindcss/postcss` | 4.3.3 | v4 语法（`@import "tailwindcss"` + `@theme`） | 4.3.3 |
| `vitest` | 5.0.1 | 无冲突 | 5.0.1 |

**pnpm 11 的两个坑（都已踩并修复）：**

1. `package.json` 的 `"pnpm"` 字段**不再被读取**，settings 搬到 `pnpm-workspace.yaml`。
2. pnpm 会自动往 `pnpm-workspace.yaml` 写占位符 `allowBuilds: <pkg>: "set this to true or false"` ——
   这个**字符串**会让后续所有安装以 `ERR_PNPM_IGNORED_BUILDS` 中止。必须换成布尔值：

   ```yaml
   allowBuilds:
     unrs-resolver: true
   ```

**ESLint 配置**：`eslint-config-next@16` 已原生导出 flat config 数组，
不需要 `@eslint/eslintrc` 的 `FlatCompat`（该包并未安装，旧写法会直接报模块缺失）。

---

## 1. 目标与非目标

### 目标

1. **丝滑导入题库**：一条命令把一份文档/JSON 变成可刷的题，校验不通过就拒绝入库。
2. **全面 Next.js 重构**：SSR/RSC + 静态预渲染，每套卷可分享链接，移动端可用。
3. **扩展性**：新增考试类型 = 新增一个 `content/<exam>/` 目录，**不改代码**。
4. 给妹妹用：不登录也能从头刷到尾，登录后进度跟人走。

### 非目标（明确不做）

- 不做题库的在线编辑器 / CMS（导入走 CLI + git，可追溯、可 review）。
- 不做用户生成内容、评论、排行榜。
- 不做付费 / 多租户。
- 不改写题目内容（抽取出来什么样就什么样，质量闸门只做拦截不做美化）。

---

## 2. 数据来源与覆盖矩阵

### 2.1 三个来源

| # | 来源 | 路径 | 性质 |
|---|---|---|---|
| S1 | 旧站结构化数据 | `D:\blog\cet6-exam-quiz\data\` | **已结构化**，46 套 1859 题，含逐题解析 |
| S2 | CET6-Resources（真题 Word/PDF） | `.sources/CET6-Resources/**/02、真题Word版/`、`01、真题PDF版/` | 原始文档 |
| S3 | CET6-Resources（答案解析 PDF） | `.sources/CET6-Resources/**/03、答案解析/` | 原始文档（**全为 Git LFS**） |

### 2.2 覆盖矩阵（实测，非估算）

数据由 `node tools/inventory.mjs` 扫描 `335` 个文件 / `39` 个考期得出，
明细见 `docs/inventory.md` 与 `docs/inventory.json`。

| 考试 | 考期 | 可识别套数 | 真题 Word（免 LFS） | 解析 PDF | 听力音频 |
|---|---|---|---|---|---|
| **CET-6** | 25（2013.06 – 2025.06） | 73 | 19 个考期有 | 24 个考期有（**全为 LFS**） | 6 个考期 / 9 个 mp3 |
| **CET-4** | 14（2014.06 – 2019.12、2024.12、2025.06） | 39 | 12 个考期有 | 14 个考期有（**全为 LFS**） | 2 个考期 / 3 个 mp3 |

**与旧站（S1）合并后的最终体量：**

| | 套数 | 来源 |
|---|---|---|
| CET-6 已有 | 46 | S1（2020.07 – 2026.06，16 个考期，含逐题解析） |
| CET-6 净新增 | **39** | S2/S3（2013.06 – 2019.12，13 个考期 × 3 套） |
| **CET-6 小计** | **85** | |
| CET-4 净新增 | **39** | S2/S3（14 个考期） |
| **总计** | **124 套** | |

> 重叠区（2020.07 – 2025.06 的 11 个 CET-6 考期）**一律以 S1 结构化数据为准**，
> S2/S3 在该区间只用于补「原卷 PDF」资产，不重新抽取题目。
>
> 仓库缺口：CET-6 无 2021.12 / 2022.03 / 2025.12 / 2026.06（S1 有）；
> CET-4 无 2020 – 2023（**真断档，UI 如实呈现，不补假数据**）。

### 2.3 ⚠ 决定性约束：解析 PDF 100% 是 Git LFS

实测结论（`git lfs pull` 已在本地验证成功）：

- `.gitattributes` = `*.pdf filter=lfs diff=lfs merge=lfs -text` → **167 个 PDF 全部 LFS**
- **38 个考期中，0 个能在不拉 LFS 的情况下拿到解析** —— 真题 Word 是实体文件，但**解析只有 PDF**
- LFS 实体化后单个解析 PDF ≈ 870 KB（以 `CET6_2019.12` 3 个文件实测 943/874/769 KB 为准）

**因此 LFS 拉取是 M10/M11 的硬前置**，命令：

```bash
# 克隆时务必跳过 smudge，否则拿到的是 131 字节指针文本（.git 也要 254 MB）
GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/YinsinSirius/CET6-Resources.git .sources/CET6-Resources

cd .sources/CET6-Resources
git lfs pull                              # 全量 PDF（≈170 MB，167 个文件）
# 或按需：git lfs pull --include="**/03、答案解析/*.pdf"
```

### 2.4 音频（可自托管的意外收获）

仓库带 **12 个实体 mp3（合计 299 MB）**，覆盖 8 个考期：

| 考试 | 考期 | mp3 数 |
|---|---|---|
| CET-6 | 2022.06 / 2022.09 / 2025.06 | 各 1 |
| CET-6 | 2022.12 / 2023.06 / 2024.12 | 各 3 |
| CET-4 | 2024.12 | 2 |
| CET-4 | 2025.06 | 1 |

旧站的 27 套听力全部依赖第三方 HLS（`listening.lazynote.cn`）。
**这 6 个 CET-6 考期可直接改用本地 mp3 自托管**，把最脆弱的第三方依赖换成可控资产。

### 2.4.1 音频现状（M6 实测修正）

> ⚠ 修正一条早期结论：M1 报表里「19 套无音频」是**误读**。
> 旧 `no-audio` 标记的含义是「`audio.js` 里没有条目」，而它几乎等同于「这套没有听力题」。

实测（`content/cet6/` 46 套）：

| 项 | 数量 | 说明 |
|---|---|---|
| 有听力题的套卷 | **27** | 其中**音源 100% 覆盖**（27 套全有） |
| 无听力题的套卷 | 19 | 都是第 2/3 套（题量不全），挂 `no-audio` 没有意义 |
| 音源已换为自托管 mp3 | **12** | 9 套直接映射 + 3 套按素材库注记共用 |
| 仍为第三方 HLS | 15 | 后续可继续用素材库或自行录制替换 |

**所以 mp3 的价值不是「补覆盖」，是「去风险」** —— 把 12/27 的音源从第三方 CDN
换成可控文件。这一点在早期叙述里说错了，此处更正。

`no-audio` 在新站改为**派生标记**：**有听力题但无音源**才算，
由 `registry.getPaper()` 按合并后的资产实时计算（旧值来自迁移时的音源快照，会过时）。
`tools/bank-index.mjs` 用同一口径，保证卡片与详情页一致。

**共用听力的依据**（素材库自带的 `.txt` 注记，不臆造）：

| 套卷 | 共用对象 | 素材库原文 |
|---|---|---|
| 2020-09-2 / -3 | 2020-09-1 | 「三套题目共用一套听力」 |
| 2022-12-3 | 2022-12-1 | 「第3套听力与第2套或第1套完全相同」 |
| 2023-06-3 | 2023-06-1 | 「第3套听力与第2套或第1套完全相同」 |
| 2024-12-3 | 2024-12-1 | 「全国考试音频是2套，第3套与前面两套共用」 |

由 `tools/assets-audio.mjs` 写入 `assets.json` 的 `sharedWith` + `note`，UI 如实标注来源。

**本地开发**：`node tools/assets-audio.mjs --copy` 会把 267MB mp3 复制到 `public/audio/`
（已 gitignore）。上生产时改用 `--base <CDN 地址>` 指向对象存储，不再走 public/（M9）。

### 2.5 ⚠ 决定性约束二：约 1/3 的 PDF 是扫描图片，另有乱码与碎裂

`node tools/pdf-probe.mjs --pages 6` 全量探测 217 个 PDF 的结果（明细见 `docs/pdf-textability.md`）：

| 类别 | text（可直接抽） | sparse（部分） | scanned（需 OCR） |
|---|---|---|---|
| 真题 | 94 | 3 | 12 |
| 解析 | 70 | 8 | 30 |
| **合计** | **164（76%）** | **11（5%）** | **42（19%）** |

**对我们真正要新增的 78 套（CET-6 2013–2019 共 39 套 + CET-4 共 39 套）的影响：**

| 目标 | ✅ 可直接抽 | 🟡 解析需 OCR | 🔴 全需 OCR |
|---|---|---|---|
| CET-6 2013.06 – 2019.12（13 考期 / 39 套） | 8 考期 / 24 套 | 5 考期 / 15 套 | 0 |
| CET-4（14 考期 / 39 套） | 10 考期 / ~30 套 | 2 考期 / ~6 套 | 2 考期 / ~6 套（2024.12、2025.06） |
| **合计** | **~54 套（69%）** | **~21 套** | **~6 套** |

> CET-6 需 OCR 的 5 个考期：2015.06 / 2015.12 / 2016.06 / 2018.12 / 2019.06（均为**解析**需 OCR，真题本身可抽）。
>
> 好消息：CET-6 2024.12 / 2025.06 / 2022.12 / 2023.06 这几个「全需 OCR」的考期，
> **旧站 S1 已有结构化数据，不必 OCR**。

**结论：L3 必须是双路抽取管线**，不能用一套 `pdftotext` 规则通吃。

> **补充（M10b 普查后修正）**：仅统计字符数会误判。实测 2017.06 抽出 57 万字符**全是乱码**
> （嵌入字体缺 ToUnicode 映射）；2019.12 字符有意义但**排版碎裂**，英文单词边界全丢。
> 判据已补齐为三条：`garbled`（正常字符占比<0.8）/ `fragmented`（短行占比>0.5）/ `text`。
> CET-6 2013–2019 的解析 PDF 里**真正可抽的只有 4 个考期**（2013.06 / 2013.12 / 2014.06 / 2018.06）。
> 详见 `docs/extraction-status.md` §六 与 `docs/ans-formats.json`。

### 2.6 素材完整性（本地已拉全，无省略）
| 检查项 | 结果 |
|---|---|
| PDF 实体化 | **217 / 217**，指针残留 **0** |
| LFS 对象缓存 | `.git/lfs/objects` 1,246 MB |
| 工作区体积 | 1,557 MB |
| git 历史 | `--unshallow` 完成，**8 commits / 3 branches**，非浅克隆 |
| `.git` 体积 | 2,333 MB |

> 复现命令（**不要**再跳过任何一步）：
> ```bash
> GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/YinsinSirius/CET6-Resources.git .sources/CET6-Resources
> cd .sources/CET6-Resources
> git lfs pull          # 217 个 PDF，1.24 GB
> git fetch --unshallow # 完整历史
> ```



---

### 2.7 ⚠ 旧站数据缺陷（M1 迁移时实测发现）

`node tools/bank-validate.mjs` 基线：**46 套 · 1859 题 · 0 error · 42 warning**。
逐条诊断与修复建议见 **`docs/legacy-defects.md`**（缺陷台账）。要点：

| 编号 | 缺陷 | 影响 | 处置 |
|---|---|---|---|
| **D1** | **信息匹配原文系统性缺尾段** | **19 套**答案字母（N/O）超出原文（恒为 13 段 A–M） | 已标 `flags: passage-truncated`；需定向重抽，**P0** |
| D2 | 题号 typo：`2021-06-2` 两个 `#31` 缺 `#26`；`2021-06-1#34` 题干标 `__(33)__` | 2 套 | 改 2 个数字，**P1** |
| D3 | 空卷 / 题量不全：`2020-09-3`、`2022-06-3` 等 6 套 | 6 套 | 标 `flags: incomplete`；可从合并 PDF 拆套补齐，P2 |
| D4 | 无听力音频 | 19 套 | 标 `flags: no-audio`；素材库 mp3 可补 6 个考期，P4 |
| D5 | 跨套重复题干 6 处（跨年份完全相同） | 待确认 | 疑似音频复用或整理串行，人工比对，P3 |

**D1 的关键证据**（源码文档对账，可对账的 11 套里 9 套缺段）：

| 套号 | 源码段落 | 旧站原文 | 缺失 |
|---|---|---|---|
| 2020-09-1 | 15 段（A–O） | 13 段 | N O |
| 2021-06-2 | 14 段 | 11 段 | L M N |
| 2024-06-2 | 15 段 | 12 段 | M N O |
| 2024-06-3 | 14 段 | 13 段 | N |

→ **答案是对的，缺的是阅读原文末尾**。这就是"迁移不篡改、缺陷显式记录"原则的用例：
迁移脚本只标记不改写，修复走可 review 的独立步骤。

### 2.8 语义陷阱：year/month ≠ 行政考期

旧索引把两套语义混在一个字段里：

| 字段 | 语义 | 示例（`2023-03-1`） |
|---|---|---|
| 旧 `year` | **行政考期归属** | `2022`（3 月场次算 2022 下半年） |
| 旧 `label` | 考试日期 | `2023年3月` |
| 新 `year` / `month` | **考试实际日期**（从 id 拆） | `2023` / `3` |
| 新 `session` | 行政考期 | `2022下半年` |

迁移时**必须分开**，否则 UI 会出现「2022年3月」这种不存在的考期。
（M1 的契约测试抓到了这个错，已验证修复。）

---

## 3. 目录结构

```
D:\blog\exam-quiz\
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx  page.tsx                      # 站点首页：考试类型入口
│  │  ├─ [exam]/
│  │  │  ├─ page.tsx                               # 年份 → 考期 → 套卷
│  │  │  └─ [paper]/
│  │  │     ├─ page.tsx                            # 整卷考试
│  │  │     └─ [mode]/page.tsx                     # listening | reading | subjective
│  │  ├─ practice/  wrong/  fav/  login/
│  │  └─ api/auth/[...nextauth]/route.ts
│  │     api/progress/route.ts                     # 登录后的进度读写
│  ├─ components/
│  │  ├─ question/     ChoiceQuestion / WordBankQuestion / ParagraphMatchQ / ClozeBlankQ
│  │  ├─ analysis/     AnalysisList（有序 label/text 渲染）
│  │  ├─ audio/        HlsPlayer（hls.js 动态加载）+ AudioPieces
│  │  ├─ ink/          InkLayer（透明手写层，React 化）
│  │  ├─ answer-sheet/ AnswerSheet 抽屉
│  │  └─ ui/           设计系统原语
│  ├─ lib/
│  │  ├─ bank/         schema.ts(Zod) · registry.ts · grade.ts · stats.ts
│  │  ├─ progress/     types.ts · local.ts · remote.ts · merge.ts
│  │  └─ utils/
│  └─ server/          db.ts(Supabase) · auth.ts · quota.ts
├─ content/                                        # ★ 题库单一真源，纯文本入 git
│  ├─ cet6/
│  │  ├─ exam.json                                 # 考试定义 + 试卷结构
│  │  ├─ papers/2020-07-1.json
│  │  └─ assets.json                               # 原卷 PDF / 解析 PDF / 音频 清单
│  └─ cet4/…
├─ tools/                                          # 导入/抽取/校验（Node，不进构建产物）
│  ├─ migrate-legacy.mjs      S1 → content/cet6（一次性）
│  ├─ doc-extract.mjs         L2：docx/doc/rtf/pdf → 候选题目
│  ├─ ans-extract.mjs         L3：解析 PDF → analysis[]
│  ├─ bank-add.mjs            L1：规范导入 + 校验 + 写盘
│  ├─ bank-validate.mjs       全量体检
│  └─ inventory.mjs           扫描 .sources，生成覆盖矩阵
├─ docs/
│  ├─ DESIGN.md               ← 本文件
│  ├─ import-format.md        题库书写格式（给"以后加题"的你）
│  └─ inventory.md            覆盖矩阵实况（由 inventory.mjs 生成）
├─ .sources/                                       # gitignore，原始素材
├─ .env.local                                      # gitignore
└─ README.md
```

---

## 4. 题库 schema（单一真源）

> 文件：`src/lib/bank/schema.ts`，Zod 定义 + `z.infer` 出 TS 类型。
> 所有读写题库的代码只能从 Zod 类型推导，禁止手写重复 interface。

### 4.1 考试定义

```ts
export const Section = z.object({
  id: z.string(),                       // 'listening' | 'cloze' | 'matching' | 'reading' | 'writing' | …
  name: z.string(),                     // '听力理解'
  kind: z.enum(['single-choice', 'word-bank', 'paragraph-match', 'cloze-blank', 'essay', 'translation']),
  questionNos: z.array(z.number()),     // 本题型覆盖的题号，显式列出（真实试卷有跳号）
  score: z.number().optional(),         // 分值，用于折算分
  renderer: z.enum(['audio-flow', 'passage-split', 'flat-list', 'subjective']),
  media: z.enum(['hls-audio', 'mp3', 'none']).default('none'),
})

export const ExamConfig = z.object({
  id: z.string(),                       // 'cet6'
  name: z.string(),                     // '大学英语六级'
  shortName: z.string(),                // 'CET-6'
  description: z.string().optional(),
  sections: z.array(Section),
  sessions: z.array(SessionMeta),       // 考期分组（年份/上下半年/考期名）
})
```

**关键点**：`sections` 是数组不是硬编码四件套。CET-4 复用同一份配置结构；将来雅思（无听力合并段、写作分 Task1/2）也只是换一份 `sections`。

### 4.2 题目：判别联合

```ts
const Base = {
  no: z.number(),
  sectionId: z.string(),
  stem: z.string(),                     // 英文题干
  stemZh: z.string().optional(),        // 中文翻译
  answer: z.string(),                   // 标准答案（字母 / 或多字母）
  answerText: z.string().optional(),    // 答案文本
  questionType: z.string().optional(),  // 细节题 / 推断题 / 主旨题 …
  difficulty: z.number().min(1).max(5).optional(),
  tags: z.array(z.string()).optional(),
  analysis: Analysis,                   // ★ 见 4.3
}

Question =
  | { kind: 'single-choice', options: {label,text,textZh?}[], …Base }
  | { kind: 'word-bank',     wordBank: Record<Letter,string>, options: […15 项词库], …Base }
  | { kind: 'paragraph-match', paraOptions: Letter[], anchor?: string, options: null, …Base }
  | { kind: 'cloze-blank',   options: […15 项词库], wordBank, …Base }
```

### 4.3 解析：有序数组，不是中文字段名对象

旧数据有三套互不相同的解析维度：

| 题型 | 旧字段 |
|---|---|
| 听力 | `定位 / 信号 / 替换 / 排除` |
| 阅读 | `判型 / 拆句 / 定位 / 选项`（部分还带 `信号/替换/排除`） |
| 匹配 | `定位 / 改写 / 辨邻` |
| 选词填空 | `词性槽 / 依据 / 竞争词 / 易错` |

新 schema 统一为：

```ts
export const Analysis = z.array(z.object({
  label: z.string(),        // '定位'
  text: z.string(),
}))
```

**渲染层只按顺序铺开，不认识任何 label。** 于是新题型可以自由定义自己的解析维度，加题不需要改渲染代码。

### 4.4 试卷

```ts
export const Paper = z.object({
  id: z.string(),                       // '2025-06-1'
  examId: z.string(),                   // 'cet6'
  year: z.number(),
  month: z.number(),
  session: z.string(),                  // '2025下半年'
  setNo: z.number(),                    // 第几套
  label: z.string(),                    // '2025年6月'
  questions: z.array(Question),
  passages: z.record(z.string(), Passage),   // key: 'cloze' | 'matching' | 'reading-1' | …
  subjective: Subjective.optional(),    // writing / translation
  assets: PaperAssets.optional(),
})
```

题号允许跳号（真实试卷存在），但 `bank-validate` 必须报告出跳号与缺题，UI 标灰。

---

## 5. 扩展机制：新增考试 = 加目录

```
content/
  cet6/exam.json   papers/*.json   assets.json
  cet4/exam.json   papers/*.json   assets.json     ← 新增考试只做这一步
```

构建期 `lib/bank/registry.ts` 扫描 `content/*/exam.json` 生成：

```ts
export const EXAMS: ExamConfig[]              // 首页考试入口
export function getPaper(examId, paperId)     // RSC 直接调用
export function listPapers(examId)            // 列表页 / generateStaticParams
```

`app/[exam]/…` 全部走 `generateStaticParams` 预渲染，加目录即上线，**零代码改动**。

**只有出现全新题型**（如简答题、排序题）才需要新增一个 `components/question/*` 组件 + `Section.kind` 枚举项。

---

## 6. 导入管线

### L1 · 规范导入（全自动）

```bash
pnpm bank:add ./2025-06-1.json --exam cet6          # 单套
pnpm bank:add ./pack/*.json     --exam cet4          # 批量
pnpm bank:add ./试题.xlsx       --exam cet4          # Excel/CSV（列头映射）
```

流程：**解析 → Zod 校验 → 归一化 → 冲突检查 → 写盘 → 重生成索引 → 报告**

- 归一化：题号补齐、选项字母统一（`a)`/`A.` → `A`）、答案大写、全角半角、空白清理
- 冲突检查：目标文件已存在时**默认拒绝**，需 `--force` 才覆盖
- 失败即拒绝写盘（不留半个文件）
- 输出：`✓ 32 题入库 · ⚠ 3 条警告`（警告不阻塞，不合法即错误拦截）

### L2 · 真题文档抽取（半自动）

```bash
pnpm bank:extract doc .sources/CET6-Resources/CET6_2017.06 --exam cet6 --out .candidates/
```

1. **文本化（按来源能力自动选路）**：
   | 输入 | 工具 | 说明 |
   |---|---|---|
   | `docx` | mammoth | 实体文件，最干净 |
   | `doc` / `rtf` | LibreOffice headless | 老二进制格式 |
   | PDF（**text**） | `pdftotext -layout` | 本机 poppler 25.07.0，已验证 |
   | PDF（**scanned**） | `pdftoppm -png` → 多模态 LLM | 走 L2-OCR 支路 |
2. 按题号 / Section 标题切题（正则 + 规则，试卷格式稳定，切分可靠性高）
3. 输出 `.candidates/<paperId>.draft.json`（**合法但未审**，带 `_warnings[]`）
4. **人工/LLM 过闸**：校对题干、选项、答案、原文分段
5. `pnpm bank:add .candidates/<paperId>.draft.json --exam cet6 --reviewed` 入库

### L2-OCR · 扫描件支路（仅 19% 的 PDF 需要）

```bash
pnpm bank:extract ocr .sources/.../2025.06英语六级解析第1套.pdf --exam cet6 --pages 1-24
```

1. `pdftoppm -r 200 -png` 逐页渲染（200 DPI 平衡清晰度与体积）
2. 逐页喂多模态模型，prompt 固化输出 schema（题干/选项/答案/原文/解析维度）
3. **强制回填校验**：OCR 结果必须答出「本题号 + 选项数 + 答案字母」三件套，
   与真题 PDF 的答案页交叉比对，不一致则整页转人工
4. 输出到 `.candidates/` 的 `*_ocr.draft.json`，**标记 `_source: 'ocr'`**，过闸时高亮提示

> OCR 产物一律带 `_source` 标记并入库到 `analysis` 的 `_ocr: true`，
> 便于日后发现有误时批量重抽。**绝不把 OCR 结果伪装成人工整理。**

### L3 · 解析 PDF 抽取（半自动，质量闸门最高）

```bash
pnpm bank:extract ans .sources/CET6-Resources/CET6_2017.06 --exam cet6 --out .candidates/
```

**双路分发**（先探测再选路，探测结果缓存在 `docs/pdf-textability.json`）：

```
解析 PDF ──► pdf-probe 判定 ──┬─ text    ──► pdftotext -layout ──┐
                              ├─ sparse  ──► pdftotext + OCR 补齐 ├─► 按题号切分
                              └─ scanned ──► pdftoppm → 多模态 LLM ┘
                                                                  │
                                            解析维度 → analysis: {label,text}[] 归一化
                                                                  │
                                                        质量闸门（见下）
```

1. 按题号锚点（`1.` / `A)` / `解析`）切分
2. 抽取四段式维度 → **归一化成 `analysis: {label,text}[]`**（维度名按 section 配表映射）
3. **闸门规则**（不过闸不许入库）：
   - 解析为空的题 → 错误拦截
   - `analysis[].text` 平均长度低于阈值（如 < 20 字）→ 警告并列出
   - 选项数 ≠ 标准数、答案不在选项集合内 → 错误拦截
   - **OCR 来源的题，答案必须与真题 PDF/答案页一致** → 不一致直接拦截
4. 过闸后 `bank:add --reviewed`

### 全量体检
```bash
pnpm bank:validate            # 退出码非 0 = 有条件不合格
```

输出：题号连续性、答案合法性、重复题干、解析缺失清单、`passages` 引用完整性、
`assets` 文件可达性。**CI 里跑，绿灯才让 merge。**

### 往返一致性校验（M8 补）

```bash
pnpm bank:roundtrip --exam cet6 --all          # 当前 46/46 通过
pnpm bank:roundtrip --exam cet6 --all --xlsx
```

导出 → 导回隔离目录 → 逐题比对 kind/题号/题干/答案/选项/词库/段落集合/解析。

**为什么必须有它**：schema 校验通过只说明「结构合法」，完全不能说明「内容没丢」。
这一轮它立刻抓出三个真问题：

| 抓到的问题 | 性质 |
|---|---|
| 匹配题的 `paraOptions` 从「全局选项列」推导 | 完形有 15 个选项列，导致 13 段的信息匹配被写成 15 段 |
| 导出没带 `para_options` 列 | 缺段套卷（答案 N/O）往返后段落集合走样 |
| `2021-06-2` 两个 `#31` | **运行时真 bug**：qid 相同 → 两题共享一个作答槽 |

### 可重跑 ≠ 可随意重跑（M8 踩到的坑）

`migrate-legacy` 会从旧站源码**重建**试卷 JSON 与 `assets.json`。重跑一次就会：

- 抹掉 `tools/assets-audio.mjs` 接进来的 12 套自托管 mp3
- 抹掉 `tools/fix-legacy-defects.mjs` 做的题号纠错

两处都已加防护：

1. **资产合并不覆盖**：`assets.json` 里带 `source` 字段的音源（= 外部接进来的）一律保留，
   迁移只填旧站 HLS 的底。
2. **试卷重建加护栏**：`content/<exam>/papers/` 非空且未传 `--force` 时直接拒绝，
   并打印「重跑后要补跑哪些命令」。

### 内容纠错与迁移分离
| 工具 | 职责 | 原则 |
|---|---|---|
| `migrate-legacy` | **结构**归一化（字段改名、判别联合、解析数组化） | 不篡改内容 |
| `fix-legacy-defects` | **内容**纠错（已确诊的题号 typo 等） | 显式、可 review、可回滚、在缺陷台账留痕 |

两者分开，是为了让「哪一处改动的依据是什么」永远可追溯。

---

## 7. 资产管线

大文件不入 git。`content/<exam>/assets.json`：

```jsonc
{
  "2025-06-1": {
    "paperPdf":  { "url": "https://<supabase>/cet6/2025-06-1-paper.pdf",  "size": 1234567, "sha256": "…" },
    "answerPdf": { "url": "https://<supabase>/cet6/2025-06-1-answer.pdf", "size": 987654,  "sha256": "…" },
    "audio":     { "kind": "hls", "url": "https://listening.lazynote.cn/cet6/97/index.m3u8",
                   "pieces": [{ "label": "Section A · 第 1 篇 · 1–4 题", "start": 38.066, "end": 218.666 }] }
  }
}
```

- 上传脚本：`pnpm assets:push` 从 `.sources` 挑文件 → Supabase Storage → 回写 `assets.json`
- 音频两种形态都要支持：`hls`（现站 CET-6 27 套，第三方源）与 `mp3`（CET-4 2024/2025 本地文件）
- UI 增量能力：**原卷 PDF 下载 / 打印**、**听力 MP3 播放**（旧站没有）

---

## 8. 应用架构

### 8.1 路由

```
/                                  考试类型入口（cet6 / cet4 …）+ 继续上次
/[exam]                            年份卡 → 考期分组 → 套卷列表（含进度条）
/[exam]/[paper]                    整卷考试（计时 / 答题卡 / 提交判分）
/[exam]/[paper]/[mode]             listening | reading | subjective
/practice                          刷题（筛选：考试 / 套卷 / 题型 / 错题 / 收藏）
/wrong                             错题本（按考试分组）
/fav                               收藏
/login                             GitHub OAuth 登录
```

### 8.2 状态与判分

- 客户端状态：**Zustand** store（答题 / 错题 / 收藏 / 草稿），`persist` 中间件 → localStorage
- 判分：`lib/bank/grade.ts`，纯函数，同源的 `stats.ts` 出统计（正确率 / 分题型 / 折算分）
- 题目组件按 `kind` 分发，未知 `kind` 渲染降级卡片（不白屏）

### 8.3 关键交互（对齐旧站并增强）

| 能力 | 说明 |
|---|---|
| 即时判分 | 点选项立刻判定，正确项标绿、错项标红 |
| 答题卡抽屉 | 分组显示对/错/未答，点击跳题 |
| 快捷键 | `A–D`/`E–O` 选项、`←` `→` 切题、`D` 开关透明模块 |
| 阅读分栏 | 左原文右题目，随分区自动切换原文 |
| 主观题 | 写作范文 + 整篇中译 + 逐段拆解；翻译参考译文 + 逐句解析；草稿自动保存 |
| 透明手写层 | 玻璃层直接手写；工具栏区域 `clip-path` 挖洞；5 色 3 粗细 / 橡皮 / 撤销 / 清空 / 存图 PNG / 穿透；笔迹按题保存 |
| **新增** | 原卷 PDF 下载、收听 MP3、多考试切换、移动端适配 |

### 8.4 登录与进度

```ts
interface ProgressStore {
  getAnswer(qid): Answer | null
  setAnswer(qid, a): void
  wrongList(): string[];  toggleFav(qid): boolean
  getDraft(paperId, kind): string;  setDraft(…): void
  stats(scope): Stats
}
```

- `LocalStore`（默认，匿名）：localStorage，功能完整
- `RemoteStore`（登录后）：`/api/progress` → Supabase
- 首次登录弹一次 **「把本机进度合并到账号」**（`lib/progress/merge.ts`，按时间戳取新）
- Supabase 表（仅 5 张）：

```sql
users(id, github_id, login, avatar_url, created_at)
answers(user_id, qid, choice, ok, answered_at, attempts)   -- PK(user_id, qid)
marks(user_id, qid, kind)                                  -- kind: 'wrong' | 'fav'
drafts(user_id, paper_id, kind, text, updated_at)
paper_sessions(user_id, paper_id, started_at, submitted_at, score)
```

RLS：全部表 `user_id = auth.uid()`，匿名角色零权限（匿名根本不打后端）。

---

### 8.5 实现决策（M3 落地时定的，与旧站有意不同）

| 项 | 旧站 | 新站 | 理由 |
|---|---|---|---|
| 透明层开关快捷键 | 单键 `D` | **`Shift+D`** | 旧站 `D` 与「选项 D 作答」抢键 —— 键盘用户实际选不了 D |
| 答题卡开关快捷键 | 单键 `B` | **`Shift+B`** | 同上，`B` 与「选项 B 作答」抢键。B 是极高频选项，冲突比 D 更严重 |
| 工具栏与画布的遮挡 | 画布 `clip-path` 挖洞 | **z-index 分层**（画布 z-30 / 工具栏 z-40） | 视觉等价，少一层几何计算，窗口尺寸变化时不会错位 |
| 笔迹坐标 | 屏幕坐标 | **文档坐标**（`client + scroll`） | 滚动时笔迹跟着内容走，而不是浮在视口上 |
| 笔迹持久化 | 按题存 localStorage | **zustand persist，按 `examId/paperId#sectionId` 分账** | 与进度同一套机制 |
| effect 内读 localStorage | — | **一律改用外部 store** | React 19 的 `react-hooks/set-state-in-effect` 把「effect 里同步 setState」判为 error |

**快捷键总表（新站）**

| 键 | 作用 |
|---|---|
| `A`–`Z` | 作答当前光标题（纯字母，不带修饰） |
| `←` `→` `↑` `↓` / `j` `k` | 移动光标 |
| `Enter` | 收起 / 展开当前题解析 |
| `Shift+B` | 开关答题卡 |
| `Shift+D` | 开关透明手写层 |
| `Esc` | 关闭答题卡 |

**一条规律**：修饰键留给「面板开关」，纯字母永远留给「作答」。
两者混用必然互相吞键 —— 旧站踩了两次（`D`、`B`），新站在 e2e 里各加了一条用例守住。

### 8.5.1 光标竞态

`keydown` 监听器在 effect 里注册，闭包捕获的 `cursor` 是**注册那一刻**的值。
用户「↓ 然后马上按 B」时，第二次 keydown 可能仍在旧闭包里执行 ——
表现为光标已移到第 2 题，答案却记到了第 1 题（e2e 抓到的真实缺陷）。

解法：用 `cursorRef` 做光标的同步镜像，处理器一律读 `cursorRef.current`；
`pick` 也改为直读 `useProgress.getState()` 而非闭包里的 `answers`。

### 8.6 进度存储的分层

```
组件层          只调 useProgress / useInk 的 action，不感知存储位置
   │
LocalStore      src/lib/progress/store.ts  (zustand + persist → localStorage)
                src/lib/ink/store.ts       (zustand + persist → localStorage)
   │
RemoteStore     M7 接入：同一组 action 覆写为 API 调用（/api/progress）
```

统计函数（`statsOf` / `statsAcross` / `statsBySection`）是**纯函数**，与存储解耦，
因此可以脱离浏览器直接单测 —— 这也是本轮 41 条测试里 20 条的落点。

**水合纪律**：页面是静态预渲染的，服务端读到的进度恒为空。所有进度 UI 必须先过
`useProgressHydrated()`（`useSyncExternalStore` 实现），否则会出现
「服务端 0/55 → 客户端 32/55」的水合不一致。

---

### 8.7 全局题目标识：必须带考试前缀

```
qid = `${examId}/${paperId}#${no}`      例：cet6/2025-06-1#13
```

**为什么不是 `paperId#no`**：CET-6 与 CET-4 存在**同名套卷** ——
`2017-06-1`、`2018-06-1`、`2019-12-1` … 两个考试都有。
只用 `paperId#no` 会让两个考试的作答、错题、收藏互相污染，
且这种 bug 在只有一个考试时完全看不出来，加第二个考试才爆。

M3 阶段用的是 `paperId#no`，本轮统一改掉，并在测试里加了
「同名套卷在不同考试之间完全隔离」和「clearPaper 不误伤同名套卷」两条用例守住它。

`submitted`（整卷交卷时间）同样按 `${examId}/${paperId}` 记账。

### 8.8 客户端题库元数据

错题本 / 收藏 / 刷题页都在浏览器里跑，需要「qid → 哪套卷的哪一部分」，
但不该为此加载 250KB 的试卷全文。于是 `bank-index.mjs` 会把一份**压缩索引**
同时写到 `public/bank/`：

```
public/bank/manifest.json        考试清单（名称 / 分值 / section / 时长）
public/bank/<examId>/index.json  套卷索引（含 sectionNos）· 当前 24.6KB
```

全部考试合计约 25KB，一次取回，模块级缓存。这两个文件由 `pnpm bank:index` 生成，
`--check` 在 CI 里校验它们与 `content/` 一致。

---

## 9. 迁移策略

### 9.1 旧站资产盘点

| 资产 | 处置 |
|---|---|
| `data/papers/*.js` 46 套 1859 题 | `migrate-legacy.mjs` → `content/cet6/papers/*.json`（**内容零改动**） |
| `data/index.js` 索引（考期 / 题号 / 分布） | 转成 `content/cet6/exam.json` 的 `sessions` + 每套卷的题号数组 |
| `data/audio.js` 27 套 HLS + 分段时间轴 | 直接进 `assets.json` 的 `audio` 字段 |
| `css/style.css` 30KB 主题 | **视觉保留、代码重写**：粉紫渐变外围 + 题目区纯白，用 Tailwind 主题变量重建 |
| `js/ink.js` 手写引擎 | 逻辑保留（笔迹模型 / 撤销栈 / clip-path 挖洞 / 导出 PNG）→ React 组件 |
| `js/store.js` | 拆成 `LocalStore` + 合并逻辑 |
| `js/app.js`（1118 行 / 33 函数） | **丢弃**，逻辑按视图拆分到 RSC + 客户端组件 |
| `index.html` 硬编码登录 | **丢弃**，换 Auth.js |

### 9.2 旧数据质量清单（迁移时如实报告，不自动伪造）

- `2020-09-3`：空卷（`count:0`，仅主观题）→ 迁移后标 `incomplete`
- `2020-09-2`：仅 30 题，**整套听力缺失**
- `2020-09-1` / `2020-12-1` 等：`nos` 跳过 45（匹配题缺 1 道）
- `cloze` / `matching` 的 `type` 字段为 `undefined`（仅听力/阅读标了 `type`）
- 音频仅 27/46 套覆盖，另 19 套无音源

> 处理原则：`bank-validate` 全部报出来，`exam.json` 里给缺失位打标记，
> UI 显示"该套缺听力音频"而不是静默假装完整。

### 9.3 旧站保留

旧目录**不动、不删、不 push**。新站跑通后你自行决定归档。

---

### 抽取管线的两条硬事实（M10a 实测）

1. **真题册里没有答案。** 「答案」在全套 2013–2019 真题 docx 里出现 0 次。
   答案与解析只在《答案解析》PDF 里 —— 所以 L2 产出的必须是**候选文件**
   （`answer: null`），不是可入库的 Paper；合并答案后才能过闸。
2. **听力题在真题册里只有选项、没有题干。** 听力问题是播音念的，不印在试题册上。
   题干必须从解析册取（旧站 README 也写了「题干取自解析册」）。
   抽取器给这类题标 `_missing: ['stem']`，合并时解析侧没补上就拒绝入库。

素材库还会**自述共享关系**，例如第 3 套里写着：

> 特别说明：由于 2017 年 6月六级考试全国共考了 2 套听力，
> 本套听力试题同第1套或第2套试题一致，因此在本套真题中不再重复出现。

抽取器识别这类注记并记入 `_listeningSharedWith`，**不重造 25 道重复题**
（重复题会污染进度统计：同一个人会把同样的题刷两遍）。

抽取的量化状态、逐年排版变体、剩余缺口见 **`docs/extraction-status.md`**。

---

## 10. 里程碑

| M | 内容 | 交付 | 估时 |
|---|---|---|---|
| **M0** ✅ | Next.js 16 + TS 6.0.3 + Tailwind v4 脚手架；设计系统（沿用粉白主题）；Vitest / ESLint | `pnpm dev` 起得来 | 完成 |
| **M1** | Zod schema + `registry` + `migrate-legacy.mjs`；46 套迁移完成 + `bank:validate` 全绿 | `content/cet6/` 46 套 JSON | 1.5d |
| **M2** ✅ | `/[exam]` 导航（年份→考期→套卷）+ 首页 + 静态预渲染 | 可点进每套卷 | 完成 |
| **M3** ✅ | 答题核心：3 种题型视图、即时判分、解析展开、阅读原文分栏、答题卡抽屉、快捷键、透明手写层 | 单题刷起来 | 完成 |
| **M4** ✅ | 整卷模式：全卷铺开 + 130 分钟倒计时 + 交卷 + 成绩报告（折算分/分题型） | 能"考一套" | 完成 |
| **M5** ✅ | 进度存储 + `/practice` 刷题入口 + `/wrong` 错题本 + `/fav` 收藏 + 全站导航徽标 | 旧站功能对等 | 完成 |
| **M6** ✅ | 听力播放器（HLS + mp3 双形态、7 段分段定位、跳题联动）、主观题作答区与草稿保存、mp3 自托管接线 | 四模式齐 | 完成 |
| **M7** | Auth.js GitHub OAuth + Supabase + 进度云同步 + 合并 | 登录可选 | 1d |
| **M8** ✅ | 导入器 L1（JSON/CSV/XLSX）+ 导出器 + **往返一致性校验** + 缺陷修复工具 + 格式文档 | 能自己加题 | 完成 |
| **M9** | 资产管线 + 原卷 PDF / MP3 接入 | 能下载打印 | 0.5d |
| **M10a** ✅ | **L2 文档抽取**（真题 Word → 题目/选项/原文/主观题面，覆盖 75.1%）；L3 解析抽取（含 OCR 支路）进行中 | 能稳定吃文档 | L2 完成 |
| **M10b** 🟡 | **CET-6 2013–2019 入库**：`2018-06-1` 已端到端入库并通过全部门禁（55 题，答案+解析齐全）；其余直接抽与 OCR 解析待做 | CET-6 达 85 套 | 3d |
| **M11** | **CET-4 全量入库**：10 考期直接抽（~30 套）+ 2 考期 OCR 解析 + 2 考期全 OCR（~9 套） | 双考试站 124 套 | 2.5d |
| **M12** | Vercel 部署 + 验收 + 文档 | 上线 | 0.5d |

**依赖链**：M0 → M1 → M2 → M3 → {M4, M5, M6} → M7；M8 可并行于 M4–M7；M10/M11 依赖 M8。

**先做的验证点**：M1 结束时先跑通"1 套卷走完 M2→M4"，确认 schema 立得住，再批量迁移——避免 46 套迁完才发现 schema 要改。

---

## 11. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 解析 PDF 是 **LFS**，不拉就没有 | 抽取无从谈起 | 已实测拉全：`git lfs pull` 217 个 PDF / 1.24GB；克隆**必须** `GIT_LFS_SKIP_SMUDGE=1`（否则 `.git` 254MB 且拿到 131B 指针） |
| **约 19% 的 PDF 是扫描图片，无文本层** | `pdftotext` 抽出 0 字，规则切分直接失效 | L3 双路分发（先 `pdf-probe` 判定再选路）；扫描件走 `pdftoppm` + 多模态；OCR 产物强制与真题答案页交叉校验，不一致转人工 |
| OCR 成本与质量 | 42 个扫描 PDF（约 600–900 页）多模态调用有费用；OCR 错字会污染解析 | 只对 **net-new 且非 text** 的 ~27 套动手（其余用 S1 数据）；产物标 `_source: 'ocr'` + `_ocr: true`，可批量重抽；答案三件套校验不过即拦截 |
| L3 解析抽取质量不稳 | 解析残缺误导备考 | 半自动 + 质量闸门（空解析硬拦截、短解析列出人工过闸）；宁可 `analysis: []` 并标"解析待补"，也不塞垃圾 |
| 听力 HLS 是第三方源（`listening.lazynote.cn`） | 防盗链 / 失效 | 源地址全部走 `assets.json` 可热切换；播放失败降级为来源页链接；CET-4 有本地 MP3 可自托管 |
| `doc`（非 docx）老旧二进制格式 | 文本化失败 | 优先取 `docx`；`doc/rtf` 走 LibreOffice headless；PDF 走 poppler 兜底。三路都失败则列入人工清单 |
| 试卷格式跨年份漂移（2013 vs 2019 排版不同） | 切题规则失效 | 切题规则**按考期分组配置**，不追求一条正则通吃；`extract` 输出切分置信度，低置信度转人工 |
| CET-4 2020–2023 数据缺档 | UI 出现空洞 | 考期列表如实渲染缺口，不造数据 |
| 题库版权 | 站点传播风险 | 参考旧站 README 的处理：**不用于商业、不公开索引**。新站默认 `robots: noindex`，Vercel 部署不加公开目录；是否加访问口令由你定 |
| Vercel 免费额度 | 流量超限 | 题库走静态内容（CDN 缓存），只有 `/api/progress` 打函数；资产走 Supabase Storage 直链不经 Vercel |

---

## 12. 附：旧数据 schema 逆向记录（保真存档）

供 `migrate-legacy.mjs` 对照使用，已用脚本对 46 个文件全量核验。

```
window.__CET6_INDEX = [{ id, label, set, count, nos[], parts{listening,cloze,matching,reading},
                         period, year, half, month }]              // 46 条

window.__CET6_AUDIO = { "<paperId>": { id, src(.m3u8), pieces[{label,start,end}] } }  // 27 条

window.__CET6_PAPERS["<paperId>"] = {
  id, label, set,
  questions: [...],                       // 每套 0–55 题
  passages: { cloze, matching, "reading-1", "reading-2" },   // 40/46 套有
  subjective: { writing:{directions,model,modelZh,outline[{no,text}]},
                translation:{directions,source,reference,sentences[...]} }   // 46/46 套有
}

题目字段按 part：
  listening  no part partName stem stemZh answer type answerText explain options optionsZh
  cloze      no part partName stem stemZh options[15] wordBank{A..O} answer answerText explain pref
  matching   no part partName stem stemZh options(null) answer answerText anchor explain paraOptions[A..M] pref
  reading    no part partName stem stemZh options answer type explain passageNo pref
```

实测分布（全量核验，非抽样）：

| 项 | 值 |
|---|---|
| 索引条目 / 实际文件 | 46 / 46（无缺失） |
| 题目总数 | **1859**（listening 675 · cloze 390 · matching 394 · reading 400） |
| 有 `passages` 的套数 | 40 / 46 |
| 有 `subjective` 的套数 | 46 / 46 |
| 音频条目 | 27 / 46 |
| `type` 字段缺失 | `matching` 全部 394、`cloze` 全部 390（`undefined`） |
| 解析维度（三套命名） | 听力 `定位/信号/替换/排除`；阅读 `判型/拆句/定位/选项`（部分含 `信号/替换/排除`）；匹配 `定位/改写/辨邻`；完形 `词性槽/依据/竞争词/易错` |

---

## 13. 下一步

本次规划到此。开工第一件事是 **M0 脚手架 + M1 schema/迁移**，并在 1 套卷上跑通全链路验证 schema。
