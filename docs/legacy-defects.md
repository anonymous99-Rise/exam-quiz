# 旧站数据缺陷台账

> 来源：`node tools/bank-validate.mjs` + 与 `.sources/CET6-Resources` 源码文档对账
> 生成时间：M1 迁移完成后
> 原则：**迁移不篡改内容**。缺陷一律记录在此，修复走显式、可 review 的步骤。

体检基线：`46 套 · 1859 题 · 0 error · 42 warning`

---

## D1 · 信息匹配原文系统性缺尾段 ⚠ 影响面最大

**现象**：19 套卷的匹配题答案字母（N / O）超出原文段落集合，原文段数恒为 13 段（A–M）。

**根因**：原文被截断，不是答案错。已用源码文档对账确认：

| 套号 | 源码段落 | 旧站原文 | 缺失 |
|---|---|---|---|
| 2020-09-1 | 15 段（A–O） | 13 段 | N O |
| 2020-09-2 | 15 段 | 13 段 | N O |
| 2020-12-1 | 15 段 | 13 段 | N O |
| 2020-12-3 | 15 段 | 13 段 | N O |
| 2021-06-2 | 14 段 | 11 段 | L M N |
| 2021-06-3 | 14 段 | 12 段 | M N |
| 2024-06-1 | 15 段 | 13 段 | N O |
| 2024-06-2 | 15 段 | 12 段 | M N O |
| 2024-06-3 | 14 段 | 13 段 | N |

**可对账的 11 套中 9 套缺段**，另 2 套完整。**答案本身正确**，缺的只是阅读原文末尾。

**受影响套卷（19 套，答案越界即命中）**：

```
2020-09-1(#44→N)            2020-09-2(#41→O #45→N)     2020-12-1(#39→N)
2020-12-3(#43→N)            2021-12-2(#37→N #40→O)     2021-12-3(#40→N #44→O)
2022-09-1(#45→N)            2022-12-2(#44→N)           2022-12-3(#43→O #45→N)
2023-06-3(#45→N)            2024-06-1(#42→N #45→O)     2024-06-3(#38→N)
2024-12-1(#41→O)            2024-12-2(#43→N)           2025-06-3(#42→O #45→N)
2025-12-1(#44→O)            2025-12-2(#42→O #44→N)     2025-12-3(#43→N)
2026-06-3(#42→N #44→O)
```

**当前处置**：`flags: ["passage-truncated"]`，UI 必须提示「本题原文缺失末尾段落」。

**建议修复**：从源码文档定向重抽 matching 原文。
- 可覆盖：旧站与素材库重叠的 **2020.07 – 2025.06** 共 11 个考期（源文档为 docx/pdf，见 `docs/inventory.md`）
- 不可覆盖：**2025.12 / 2026.06** 的 3 套 —— 素材库没有，需另找来源
- 成本低：只重抽 1 个 passage 字段，不碰题目与解析

---

## D2 · 题号异常（3 套）✅ 已修复

| 套号 | 现象 | 诊断 | 处置 |
|---|---|---|---|
| `2021-06-2` | 出现两个 `#31`，缺 `#26` | 第一个 31 的题干 `It was quite a , given where she had been two years earlier.` 无题号标记，实为**第 26 题** | ✅ **已修**（`31 → 26`） |
| `2021-06-1` | `#34` 题干里写的是 `__(33)__` | 题号标记未同步（#33 答案 G、#34 答案 A，是两道不同的题） | ✅ **已修**（标记 `33 → 34`） |
| `2020-09-1` `2020-12-1` `2022-12-2` `2025-12-3` `2026-06-3` | 缺 `#45`（部分缺 44 与 45） | 真缺题 | **不补**，保持 `missing-nos` 标记 |

### ⚠ D2 不只是数据不整齐，是运行时的真 bug

进度存储的键是 `qid = ${examId}/${paperId}#${no}`。**两个题号相同的题会共享同一个作答槽** ——
答了其中一个，另一个也跟着变成已答。原 `2021-06-2` 正是这种情况。

修复方式：`tools/fix-legacy-defects.mjs`（显式、可 review、可回滚，不混在迁移里）：

```bash
pnpm bank:fix-legacy          # 预演
pnpm bank:fix-legacy --apply  # 写入
```

它的存在本身就是对「迁移不篡改内容」这条原则的补充说明：
**结构归一化归迁移，内容纠错归这个工具，两者都要留痕。**


---

## D3 · 空卷 / 缺题型（6 套）

| 套号 | 情况 |
|---|---|
| `2020-09-3` | 0 题，仅主观题 |
| `2022-06-3` `2022-09-2` `2022-09-3` `2023-03-2` `2023-03-3` | 题量不全 |

**处置**：`flags: ["incomplete"]`，UI 标灰并显示实际题量。
这些套卷在素材库里同样只有部分文档（多为「第2、3套」合并 PDF），**重抽可以补齐**，见 M10。

---

## D4 · 无听力音频（19 套）

46 套中仅 27 套有音频（第三方 HLS）。缺口 19 套。

**处置**：`flags: ["no-audio"]`。

**改善路径**：素材库自带 12 个实体 mp3（299 MB），覆盖 6 个 CET-6 考期
（2022.06 / 2022.09 / 2022.12 / 2023.06 / 2024.12 / 2025.06），可换成本地自托管；
其余需另找音源。见 `docs/DESIGN.md` §2.4。

---

## D5 · 跨套重复题干（7 处，待人工确认）

```
2021-06-1#34 ↔ 2021-06-1#33      ← 同套内重复，已确认为 D2 的编号缺陷
2023-03-1#2  ↔ 2022-06-1#5
2025-06-2#5  ↔ 2020-12-2#1
2025-06-3#55 ↔ 2022-06-1#55
2025-12-1#1  ↔ 2021-06-1#1
2025-12-1#18 ↔ 2025-06-2#21
2026-06-1#1  ↔ 2020-12-2#1
```

除第一行外，其余是**跨年份**的完全相同题干。两种可能：
1. 四六级听力确实会复用音频素材（可能）
2. 旧站整理时复制粘贴串了（需人工比对音频/解析页确认）

**处置**：暂不改动，列入人工确认清单。若为复制错误，需从源文档重抽该题。

---

## 修复顺序建议

| 优先级 | 缺陷 | 成本 | 收益 |
|---|---|---|---|
| P0 | **D1** 匹配题原文缺尾段（19 套） | 中（只重抽 1 个字段，11 个考期有源） | 高 —— 直接决定该题型能否作答 |
| P1 | **D2** 编号 typo（2 套） | 极低（改 2 个数字） | 中 |
| P2 | **D3** 空卷/缺题型（6 套） | 中（需从合并 PDF 拆套） | 中 |
| P3 | **D5** 跨套重复题干（6 处待确认） | 低（比对即可） | 低 |
| P4 | **D4** 无音频（19 套） | 高（需外部音源） | 中 |

---
---

# 2026-02-15 · 题库全量审计（47 套 / 1914 题）

> 审计脚本：`tmp/audit-bank.mjs`（临时，审计后删除）· 修复脚本：`tools/fix-bank-audit.mjs`（保留，可复跑）
> 修复前后命令与结果：
> ```
> node tools/fix-bank-audit.mjs                      # 预演：选项污染 26 处 · flags 修正 12 套
> node tools/fix-bank-audit.mjs --apply
> node tools/bank-index.mjs                          # ✓ cet6: 47 套（29 套带 flags）
> node tools/bank-validate.mjs                       # ✓ 0 error · 42 warning（与修复前同量）
> node tools/bank-roundtrip.mjs --exam cet6 --all     # ✓ 47 套全部一致（格式 CSV）
> ```
> 原则未变：**能证明的才改；真题材料本身缺的内容不编造，只如实补 flag**。

## 审计判据（10 类，逐套逐题）

| # | 类别 | 判据 | 结果 |
|---|---|---|---|
| 1 | 空卷 | `questions.length === 0` | 6 套（D3 已知） |
| 2 | 题号跳号/缺失/重复 | 实际题号 vs `exam.json` 各 section 的 `questionNos` | 5 套缺题号；无重复 |
| 3 | 答案越界 | 不在 options / wordBank / paraOptions 内 | 27 条，全部是 D1 的匹配题越界 |
| 4 | 结构异常 | 单选选项≠4 / 词库≠15 / 匹配段落集合 < 13 | 0 / 0 / 匹配集合 11–13（见「未改清单 U3」） |
| 5 | 题干空或重复 | 空串；同套内、跨套去重比对 | 0 空；14 条重复（见「未改清单 U2/U3」） |
| 6 | passages 缺失/空 block | 有 word-bank/paragraph-match/reading 题型却缺原文；`blocks` 为空 | **0 条** |
| 7 | flags 与实际不符 | 见下「flags 判据」 | 修复前 23 套不符 → 修复后 0（按下方判据） |
| 8 | 主观题 | `writing`/`translation` 缺失；`translation.sentences` 为空 | 1 套（2018-06-1，抽取套卷，允许为空） |
| 9 | 音频资产 | kind/url 匹配、pieces 递增且 start<end、mp3 有 size、duration≥末段 | 0 条结构错误；覆盖 30/47 套 |
| 10 | 答案分布 | 单套内某字母 > 50% | **0 套**（单套最高 27%，全库 listening A 25.6% / reading A 25.4%） |

**flags 判据（本次采纳，并同时写进 `tools/fix-bank-audit.mjs`）**

| flag | 判据 |
|---|---|
| `incomplete` | `questions.length === 0` |
| `missing-nos` | 本套**有题的** section 未覆盖 `exam.json` 声明的全部题号 |
| `no-analysis` | 存在 `analysis.length === 0` 的题 |
| `no-audio` | 该套在 `content/cet6/assets.json` 中**没有音频条目** |
| `passage-truncated` | ① 匹配题答案字母超出 `paraOptions`；**或** ② 匹配原文最后一个 block 未以句末标点收尾（`raw` 同） |

> 判据 ② 是本次新增。原台账只用 ①，于是漏掉了「末段被腰斩但答案恰好没越界」的 3 套。
> 依据：`passages.matching.raw` 与 `blocks` 末尾逐字相同且都停在半句（如 2023-12-1 停在
> `…far behind the 2.5 times improvement in Asia`）—— 完整原文的段落不可能这样收尾。
> 已用 `.sources` 原卷交叉验证 ① 的正确性：2020.09/2020.12 的 docx 里匹配原文段落数为
> **16 / 15 / 18 / 16**（A–P、A–O、A–R、A–P），而旧站只存 A–M(13) —— 缺的是原文，不是答案。

---

## D6 · 选项尾部污染（26 处 / 13 套）✅ 本次已修

**现象**：题目的**最后一个选项 D** 把紧随其后的试卷结构文字一起吞了。

```
2020-12-1#15 D) "Do whatever is possible to look smart. Section C"
2025-06-2#4  D) "Let John make the final decision. Questions 5 to 8 are based on the conversation you have just heard."
2018-06-1#8  D) "It is Italy's most famous type of red wine. Directions: In this section, you will hear two passages. …"
2026-06-2#21 D) "If the light from the telescope confirms their idea. 1 Parents have a small window where they can …"
2026-06-1#55 D) "It would continue because of noncooperation from the U.S. Part IV Translation (30 minutes)"
```

**分布**：26 处，**全部是 option D**，全部落在「某个 section / 阅读篇章的最后一道题的最后一个选项」。
`2025-06-*` / `2026-06-*` 与 `2024-06-2#18` 共 12 处是「`Questions 51 to 55 are based on the following passage.`」，
8 处是「`Part IV Translation (30 minutes)`」，其余为 Directions / Section / 篇章序号 / `Passage Two`。

**三条独立证据**（都留痕，可复核）：

1. **`answerText` 自洽**：当正确答案恰好是 D 时，字段 `answerText` 保存的就是**干净的选项文本**，
   与截断结果逐字相同 —— `2020-12-1#15`、`2025-06-2#4`、`2026-06-2#21` 三处全部命中。
2. **原卷对照**：`.sources/CET6-Resources/CET6_2020.12/02、真题Word版/2020年12月六级真题（第1套）.docx` 中，
   `D) Do whatever is possible to look smart.` 与 `Section C` 是**两个独立段落**；
   `21.A) They seem positive.C) They are illustrative. / B) They seem intuitive.D) They are conclusive.`
   之后才是下一篇文章。`2018.06六级真题第1套.pdf` 同理（`D) It is Italy's most famous type of red wine.`
   之后才是 `Section B`；`D) Popularizing the rice crossbreeding technology.` 之后才是 `Passage Two`）。
3. **污染内容本身**：被吞进去的是「试卷说明 / 下一篇文章」——按定义不可能属于选项。

**根因**：`tools/doc-extract.mjs` 的主循环里，任何**未识别**的行都会并进「上一个选项的文本」
（第 482–492 行）。`Directions: …`（以及 docx 一行一段落变体里的 `Section B Questions 9 to 11 …`）
不是 `RE.section`（要求整行恰为 `Section X`）也不是 `RE.qRange`（要求整行以 `Questions` 开头），
于是被当作选项续行。旧站数据同样带这个缺陷（`provenance.source = legacy`），`.candidates/2018-06-1.draft.json`
里也逐字复现 —— 所以这是**数据缺陷**，不只是抽取器缺陷。

**处置**：`tools/fix-bank-audit.mjs` 按判据截断到污染起点前的完整句，并把该判据**同时加进
`tools/bank-validate.mjs` 作为回归守卫**（修复后 0 命中；已用 `git show HEAD:` 取回修复前的
`2018-06-1.json` 放进临时 content 目录实测，守卫正确报出 3 条）。

| 套号 · 题号 | 截断后的选项 D |
|---|---|
| 2018-06-1#8 | It is Italy's most famous type of red wine. |
| 2018-06-1#15 | The amazing amount of personal attention people would like to have. |
| 2018-06-1#50 | Popularizing the rice crossbreeding technology. |
| 2020-12-1#15 | Do whatever is possible to look smart. |
| 2020-12-1#21 | They are conclusive. |
| 2020-12-2#21 | It is thought to be related to food consumption. |
| 2023-03-1#11 | Being super sports stars without appearing arrogant. |
| 2024-06-2#18 | They are unlikely to alter people's position without more evidence. |
| 2025-06-1#50 | Pressuring schools to reduce unexcused ones. |
| 2025-06-1#55 | They encourage these workers to realize their aspirations. |
| 2025-06-2#4 | Let John make the final decision. |
| 2025-06-2#50 | Judge people on the basis of their distinctive character traits. |
| 2025-06-2#55 | Lacking resources to address biological problems. |
| 2025-12-1#50 | Success experts often lead people to ruin. |
| 2025-12-1#55 | Restore social order for a harmonious nation. |
| 2025-12-2#50 | It is indispensable to avoiding shallow relationships. |
| 2025-12-2#55 | Explain their chosen way of handling the situation. |
| 2025-12-3#50 | Remind them of the distraction from mobile phones and social media. |
| 2026-06-1#8 | To bring their capabilities fully into play. |
| 2026-06-1#50 | Their parents' educational background and life. |
| 2026-06-1#55 | It would continue because of noncooperation from the U.S. |
| 2026-06-2#21 | If the light from the telescope confirms their idea. |
| 2026-06-2#50 | The more it is exercised, the more strengthened it gets. |
| 2026-06-2#55 | Online dangers are as serious as problems with teenagers' mental health. |
| 2026-06-3#50 | It is subject to different interpretations. |
| 2026-06-3#55 | Governments are turning to them for help. |

**回归**：`node tools/fix-bank-audit.mjs` 复跑应为「选项污染修复 0 处」（幂等已验证）。

---

## D7 · 题号缺失但未标 `missing-nos`（5 套）✅ 本次已修

D2 的原记录写「保持 `missing-nos` 标记」，但**数据里根本没有这个标记**（台账与数据不符）。本次补上：

| 套号 | 现象 | 处置 |
|---|---|---|
| `2020-09-1` | matching 缺 `#45`（声明 10 实际 9） | `flags += missing-nos` |
| `2020-12-1` | matching 缺 `#45` | 同上 |
| `2022-12-2` | matching 缺 `#45` | 同上 |
| `2025-12-3` | matching 缺 `#44 #45`（声明 10 实际 8） | 同上 |
| `2026-06-3` | matching 缺 `#45` | 同上 |

**不补题**：这 5 套的缺题在 `.sources` 里同样没有（2025.12 / 2026.06 素材库未覆盖），
**不编造**，只如实标注。

---

## D8 · `passage-truncated` 漏标（3 套）✅ 本次已修

按判据 ②（末段腰斩）新增 flag：

| 套号 | 匹配段落集合 | 原文末尾（`raw` = 末 block 末尾） |
|---|---|---|
| `2023-12-1` | A–K(11) | `…still far behind the 2.5 times improvement in Asia` |
| `2025-06-2` | A–M(13) | `…These, combined with a rapidly rising world` |
| `2026-06-2` | A–M(13) | `…Ewing, now 75,` |

这 3 套的答案恰好都在段落集合内，所以旧判据（答案越界）抓不到；但原文确实缺尾段。

---

## D9 · `no-audio` 标注与实际不符（4 套）✅ 本次已修

判据：`no-audio` ⟺ 该套在 `assets.json` 中没有音频条目。

| 套号 | 改动 | 依据 |
|---|---|---|
| `2018-06-1` | `flags += no-audio` | 有 25 道听力题，但 `assets.json` 无该套条目 —— 漏标 |
| `2022-12-3` `2023-06-3` `2024-12-3` | `flags -= no-audio` | `assets.json` **有**该套 mp3，标注与事实相反 |

修复后：无音频套卷 17 套，全部带 `no-audio`；其余 30 套全部有音源。

---

## 未改清单（改不了 / 不该猜）

### U1 · 匹配题原文缺尾段（22 套）—— 需要源文件才能补

`passage-truncated` 标记正确，但**缺的原文补不上**：

- **可补的 11 个考期**（`.sources` 有原卷，2020.07 – 2025.06）：需重抽 `passages.matching` 一个字段，
  不碰题目与解析。已确认可对账的 4 套：2020-09-1（源 16 段 A–P）、2020-09-2（源 15 段 A–O）、
  2020-12-1（源 18 段 A–R）、2020-12-3（源 16 段 A–P）；旧站一律只存 13 段（A–M）。
  ⚠ 反例：2024-06-2 的 docx 只到 A–L，且该套答案有 N —— **这份 docx 本身也是残的**，
  补这个考期要另找源。
- **不可补的 4 个考期（2025.12 / 2026.06 共 6 套）**：素材库完全没有这两个考期，需要另找来源。
- **无法核对**：`2021-12`、`2025.06`（PDF 无文本层 / 文本层不可用）、`2023.12`（PDF 文本层是乱码）、
  `2024.12`（段落标号抽取失败）。这些套卷的 `passage-truncated` 依赖内部判据（答案越界或末段腰斩），没走外部对账。

### U2 · 跨套重复题干（6 处）—— 需人工比对音频/解析页

D5 已记录，本次复核确认**未改动**：

```
2023-03-1#2  ↔ 2022-06-1#5    "What do we learn about the woman?"
2025-06-2#5  ↔ 2020-12-2#1    "What are the speakers mainly talking about?"
2025-06-3#55 ↔ 2022-06-1#55   "What message does the author try to convey at the end of the passage?"
2025-12-1#1  ↔ 2021-06-1#1    "What do we learn about the man from the conversation?"
2025-12-1#18 ↔ 2025-06-2#21   "What does the speaker advise us to do at the end of the talk?"
2026-06-1#1  ↔ 2020-12-2#1    "What are the speakers mainly talking about?"
```

两种可能（听力素材复用 / 旧站复制粘贴串行）**无法只靠题库判断**。要定论得有音频或解析册原页。
建议材料：对应考期的听力音频（可听题干）或 `.sources` 解析 PDF（2013–2019 有，2020+ 的部分需要 OCR）。

### U3 · 2018-06-1 完形题干成对重复（4 对）—— 不是错误，是粒度问题

```
#26 ↔ #27、#28 ↔ #29、#31 ↔ #32、#34 ↔ #35
```

这 4 对的「重复」是**真实存在的**：原句里本来就有两个空位，抽取器把「含空位的那个句子」同时给了两道题
（如 #26 的题干里同时有 `__(26)__` 和 `__(27)__`）。既没有编造，也没有串行，所以**不改**。
代价是 UI 上这两题显示同一句上下文；若要每题只显示自己的空位，需要重抽或改渲染层（`src/**`，本次不动）。

### U4 · `no-audio` 的两套判据并存（未决）

`tools/bank-index.mjs` 派生 `no-audio` 时用的是 `hasListening && !hasAudio`（有听力题且无音源），
而 `schema.ts` 与本次采用的口径是 `!hasAudio`（无音源）。差异面 = **11 套有 0 道听力题且无音源的套卷**
（如 `2020-09-2`、`2021-06-3`、`2022-06-2`、6 套空卷……）：本次口径给它们打 `no-audio`，
但 `bank-index` 写 index.json 时会把它剔掉。

两套口径都说得通（前者「没听力可播就不必提醒」，后者「事实就是没音源」）。
本次**保守保留信息**（不删真实的「无音源」事实），没有改代码。
**需要项目决定**：要么把 `bank-index` 的派生条件放宽成 `!hasAudio`，要么把这一批 `no-audio` 从数据里去掉。
在此之前，`papers/*.json` 的 flags 与 `index.json` 的 flags 对这 11 套会不一致（**修复前就不一致**，非本次引入）。

### U5 · 空卷/缺题型（6 套）—— 已在 D3 记录

`2020-09-3` `2022-06-3` `2022-09-2` `2022-09-3` `2023-03-2` `2023-03-3` 共 0 题。
`.sources` 多为「第2、3套合并 PDF」，重抽可补，但**本次不编造**。

### U6 · 抽取器根因未改（只有守卫）

`tools/doc-extract.mjs` 第 482–492 行「未识别行 → 并进上一个选项」是 D6 的根因。
本次**只加了数据侧回归守卫**（`bank-validate.mjs`），没有改抽取器 ——
因为改抽取器需要跑完整的 L2 重抽才能验证不回归，本次没有这个验证条件（2018.06 第1套是 `.doc`，
需要 Word COM）。建议后续单独做：识别结构行（`Directions` / `Section` / `Questions` / `Part` / `Passage`）
起头即视为「段落边界」，既不并进选项、也进入「说明块」状态直到下一个可识别锚点。

