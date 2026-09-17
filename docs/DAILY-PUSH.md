# 每日推送模块（/daily）

> 上游：金山词霸「每日一句」公共接口（`api.timelessq.com`）
> 代码：`src/lib/daily/*` · `src/components/daily/*` · `src/app/daily/page.tsx` · `src/app/api/daily/route.ts`

## 一、三个接口（实测确认）

| 用途 | 接口 | 参数 | 返回 |
| --- | --- | --- | --- |
| 今日 | `GET /english-sentence` | 可选 `?date=YYYY-MM-DD`（取指定日）、`?sid=` | 单条 |
| 随机 | `GET /english-sentence/random` | 无 | 单条 |
| 往期 | `GET /english-sentence/list` | `?page=1&pageSize=20` | 分页（`count=5162`、`totalPages=259`） |

单条字段：

```json
{
  "errno": 0, "errmsg": "",
  "data": {
    "_id": "6aaabd000877203247d77172", "sid": "6081", "date": "2026-09-17",
    "content": "Warm bread on the table feels like home.",
    "note": "桌上的热面包，闻起来像家。",
    "tts": "https://…/a721341b…mp3",
    "picture": "…", "middlePicture": "…", "smallPicture": "…", "largePicture": "…", "sharePicture": "…",
    "caption": "词霸每日一句", "translation": "新版每日一句"
  }
}
```

## 二、两代数据不一样（这是本模块最容易踩的坑）

上游 2012 年至今积累了 5162 条，字段一路在变：

| 字段 | 新版（2023+） | 老版（2012–2018） |
| --- | --- | --- |
| `sid` | 字符串 `"6081"` | **数字** `3210` |
| `tts` | 有官方配音 | `null`（没有） |
| 配图 | `staticedu-wps-cache.iciba.com` | `cdn.iciba.com` / `ks3-cn-beijing…ksyun.com` |
| `translation` | 占位「新版每日一句」 | **小编的话**（几百字点评散文） |

所以 `src/lib/daily/sentence.ts` 先做归一化（纯函数、可单测）：

- 数字/字符串统一成字符串；`0` / `false` 当「没有」（老数据里 `tts: 0` 就是从缺值变来的）；
- `translation` 只有当它是**真点评**（>24 字且不在占位白名单里）才作为「小编的话」展示；
- 配图按 `middlePicture → picture → largePicture → smallPicture` 逐级回落。

**踩过的坑（值得记）**：一开始漏了拆信封 —— 上游是 `{errno, errmsg, data}`，
归一化直接作用在信封上当然找不到 `content`，于是**三个面板全变空态，而网络/状态码/超时全部正常**。
现在拆信封是独立函数 `unwrapEnvelope()`，并有单测钉住。

## 三、架构：为什么全部走服务端

```
浏览器 ──► /daily（ISR，revalidate 1800s）
              ├── 今日  fetchSentence()      ← 服务端，fetch next.revalidate=1800
              ├── 随机  fetchRandom()        ← 服务端，fetch next.revalidate=300
              └── 往期  fetchArchive(1)      ← 服务端，fetch next.revalidate=3600
浏览器 ──► /api/daily?kind=random     ──► fetchRandomFresh()（no-store，实时）
浏览器 ──► /api/daily?kind=archive&page=N ──► fetchArchive(N)
```

三条理由：

1. **上游没有 CORS 保障**（第三方个人服务），浏览器直连随时可能被跨域拦掉；
2. 第三方域名不该出现在前端代码里 —— 换源只改 `src/lib/daily/api.ts` 一处；
3. 页面已经是 ISR，构建产物本身就是缓存：上游抖动时用户看到的仍是上一轮的好数据。

纪律：`src/lib/daily/api.ts` 里**没有任何 throw**，全部返回
`{ ok: true, data } | { ok: false, reason }`（8 秒超时 + `AbortSignal.timeout`）。
页面取不到时照常 200，面板给出说清原因的空态 —— 每日推送是「有就看」的内容，
为它整页 500 不可接受。

## 四、界面取舍

- **三面板不懒加载**：今日与随机在服务端就取好一起发过来，切页签零延迟。每日推送是
  「看一眼就走」的内容，转圈圈最劝退。
- **配图默认不加载**：上游那张成品图 400–700KB，为一句 60 字的推送在首屏下载它不值；
  点「看配图」才挂 `<img loading=lazy>`（并带 `onError` 兜底文案）。
- **往期用原生 `<details>` 手风琴**：零状态、零 JS 也能展开；收起态只占一行，扫读快。
- **手势不能打架**：`useSwipe` 挂在 window 上，两个组件同开会双触发。往期面板打开时
  关掉页签手势（`enabled`），左右滑交给 `ArchiveList` 翻页。
- **分页复用词表那套**：桌面页码胶囊 + 移动吸底条（同一套控件语言，用户不用重新学）。
- **日期不经过本地时区**：`formatCnDate()` 直接按年月日构造 UTC 时间取星期，
  否则服务端（UTC）与客户端（东八区）会在 23:00–01:00 之间差出一天。

## 五、维护

```powershell
# 单测（归一化 / 信封 / 日期格式化）
pnpm exec vitest run src/lib/daily

# 端到端（结构 + 换一句 + 往期翻页，上游被 mock 掉，不依赖第三方）
pnpm exec playwright test e2e/daily.spec.ts
```

上游改版时的排查顺序：

1. 直接打接口看信封有没有变（`curl "https://api.timelessq.com/english-sentence"`）；
2. 若字段改名/改类型，只改 `sentence.ts` 的 `normalizeSentence`（组件不用动）；
3. 页面全空态但接口正常 → 先怀疑**信封没拆**（本模块的历史 bug），其次是 `reason`
   （空态 UI 会把 `reason` 显示的，`upstream-timeout` / `upstream-errno-4xx` 一眼可辨）。
