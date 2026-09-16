# 题库导入格式说明

> 面向「以后要加题的人」。三种输入格式任选，**导入前一律过 Zod 校验，不合规不写盘**。

工具一览：

```bash
pnpm bank:add   <文件> --exam cet6 --paper 2025-06-1   # 导入
pnpm bank:export cet6/2025-06-1 --out ./tmp/            # 导出（CSV / --xlsx）
pnpm bank:roundtrip --exam cet6 --all                   # 往返一致性校验
pnpm bank:index                                         # 重建索引（导入后必跑）
pnpm bank:validate                                      # 全量体检
```

---

## 一、选哪种格式

| 格式 | 何时用 | 能承载 |
|---|---|---|
| **JSON** | 全量录入、程序生成、含原文与主观题 | 一切（题目 + 阅读原文 + 写作翻译 + 资产） |
| **CSV / XLSX** | 人工录入、Excel 里批量校对、补题 | 只有题目（原文与主观题需另行提供） |

> 表格路径若目标套卷**已存在**，按「只替换题目」合并 —— 原文、主观题、音频资产都保留。
> 这是补题/改题最常用的路径。

---

## 二、JSON 格式

直接就是 `src/lib/bank/schema.ts` 里的 `Paper`，完整定义以该文件为准。最省事的起手方式是**导出后再改**：

```bash
pnpm bank:export cet6/2025-06-1 --out ./tmp/     # 先看一份真实样例
```

关键点：

```jsonc
{
  "id": "2025-06-1",           // 必须与文件名一致
  "examId": "cet6",
  "year": 2025, "month": 6,    // ⚠ 考试实际日期，不是行政考期
  "session": "2025上半年",     // 行政考期（分组用）
  "setNo": 1,
  "label": "2025年6月",
  "questions": [ /* 见下 */ ],
  "passages": { "cloze": { "id": "cloze", "raw": "…", "blocks": [{ "text": "…" }] } },
  "subjective": { "writing": { … }, "translation": { … } },
  "flags": []
}
```

### 题目：判别联合

`kind` 决定字段集，**不是靠 `part` 字符串**：

```jsonc
// 单选（听力 / 仔细阅读）
{ "kind": "single-choice", "no": 1, "sectionId": "listening",
  "stem": "What did the woman do last Tuesday?", "stemZh": "这位女士上周二做了什么?",
  "options": [ { "label": "A", "text": "…", "textZh": "…" } ],
  "answer": "C", "analysis": [ { "label": "定位", "text": "…" } ] }

// 选词填空（15 选 10）
{ "kind": "word-bank", "no": 26, "sectionId": "cloze",
  "stem": "They were __(26)__", "answer": "J", "answerText": "intrigued",
  "wordBank": { "A": "aesthetic", "…": "…", "O": "weeding" },
  "options": [ { "label": "A", "text": "aesthetic" } ] }

// 信息匹配
{ "kind": "paragraph-match", "no": 36, "sectionId": "matching",
  "stem": "…", "answer": "G", "anchor": "找信息却建立彼此联系",
  "paraOptions": ["A", "B", "…", "M"] }
```

### 解析：**有序数组**，不是中文字段名对象

```jsonc
"analysis": [
  { "label": "定位", "text": "…" },
  { "label": "信号", "text": "…" },
  { "label": "替换", "text": "…" },
  { "label": "排除", "text": "…" }
]
```

渲染层只按顺序铺开，**不认识任何 label**。所以题型可以自定义自己的解析维度
（听力 `定位/信号/替换/排除`、完形 `词性槽/依据/竞争词/易错`、匹配 `定位/改写/辨邻`）。

常用维度与建议顺序（`tools/bank-export.mjs` 会按此顺序列出列）：

```
判型 · 拆句 · 定位 · 信号 · 替换 · 锚点 · 改写 · 辨邻
词性槽 · 依据 · 竞争词 · 排除 · 选项 · 易错
```

> 新增维度无需改代码；只要 `label` 是任意字符串即可。空文本的条目会被丢弃。

---

## 三、CSV / XLSX 格式

**一行一题**，第一行表头。

### 必填列

| 列名 | 说明 |
|---|---|
| `paper_id` | 如 `2025-06-1`（也可用 `--paper` 指定，列值会覆盖） |
| `section` | `listening` / `cloze` / `matching` / `reading` |
| `no` | 题号（`26`、`第26题`、全角 `２６` 都认） |
| `stem` | 英文题干 |
| `answer` | 答案（`c` / `Ｃ` / `C.` 都认；多选连写如 `AB`） |

### 可选列

| 列名 | 别名 | 说明 |
|---|---|---|
| `stem_zh` | 题干翻译、中文题干 | 中文题干 |
| `option_a` … `option_o` | `选项A`、裸字母 `A` | 选项正文（可带 `A)` 前缀，会被剥掉） |
| `option_a_zh` … | `A中文`、`选项A译文` | 选项中文翻译 |
| `answer_text` | 答案文本 | 如选词填空的单词 |
| `question_type` | 题型 | 细节题 / 推断题 … |
| `anchor` | 锚点 | 信息匹配的定位锚点 |
| `para_options` | 段落、段落集合 | 信息匹配的段落集合，空格分隔：`A B C … M` |
| `explain_<标签>` | `解析：<标签>`、`说明-<标签>` | 每条解析一列，列的顺序即渲染顺序 |

### 例

```csv
paper_id,section,no,stem,answer,option_a,option_b,option_c,option_d,explain_定位,explain_排除
2025-06-1,listening,1,"What did the woman do last Tuesday?",C,"Met the computer technician.","Told the man about her trouble.","Called the man's company.","Visited Alpha Maintenance.","I spoke to a lady there last Tuesday","A) 原词陷阱…"
2025-06-1,cloze,26,"They were __(26)__",J,,,,
```

> **段落集合（`para_options`）务必显式给出**。它来自阅读原文，表格里没别的地方能放；
> 不给的话导入器只能默认 `A–M` 并按答案最大字母扩展，缺段套卷会走样。

---

## 四、归一化规则（只做等价改写）

| 项 | 处理 |
|---|---|
| 全角字母数字 | `ＡＢＣ１２３` → `ABC123`（**只用于结构字段**，中文正文不动） |
| 选项标号 | `A)` / `a.` / `（A）` / `(A)` / `E、` / `A：` 统一剥成 `A` |
| 答案 | 转大写、去标点、去重排序（`BA` → `AB`） |
| 题号 | `第26题` / `２６` / `26.` → `26` |
| 说明标签 | `定位：` → `定位` |
| 零宽字符 / BOM | 删除（从网页复制时常见） |
| 换行 | CRLF → LF、去行尾空格、连续空行压成一个 |
| 词库键序 | 按 A–O 排列 |

⚠ **`toHalfWidth` 不能用在中文正文上**：全角逗号 `，`(U+FF0C) 会被转成半角 `,`，
而句号 `。`(U+3002) 不会 —— 同一句里标点变成两套。正文只走 `cleanText`。
（这条有单测守着，见 `src/lib/bank/normalize.test.ts`）

---

## 五、校验与拒绝

**校验不过一律拒绝写盘**，不留半个文件。会拦截：

- schema 不合法（字段缺失、答案非法、题号非正）
- 答案不在选项集合 / 词库 / 段落集合内
- 表格缺少必需列、section 写错、题干为空

会**警告但不拦截**（`--strict` 可把警告升级为失败）：

- 题号跳号 / 重复
- 题目无解析
- 目标套卷已存在（JSON 路径需 `--force`）
- 表格缺 `para_options`（走默认段落集合）

```bash
pnpm bank:add ./new.csv --exam cet6 --paper 2025-06-1 --dry      # 只看校验结果
pnpm bank:add ./new.csv --exam cet6 --paper 2025-06-1 --strict   # 有警告就失败
```

---

## 六、导完必做

```bash
pnpm bank:index      # 重建索引（否则列表页看不到新题）
pnpm bank:validate   # 全量体检，0 error 才算过关
```

验证「导入没丢内容」的最硬手段是**往返校验**：

```bash
pnpm bank:roundtrip cet6/2025-06-1          # 单套
pnpm bank:roundtrip --exam cet6 --all       # 全量（当前 46/46 通过）
pnpm bank:roundtrip --exam cet6 --all --xlsx
```

它做的是：导出 → 导回隔离目录 → 逐题比对 kind/题号/题干/答案/选项/词库/段落集合/解析。
**光看 schema 校验通过说明不了内容没丢** —— 这个工具就是为了堵这一点。
