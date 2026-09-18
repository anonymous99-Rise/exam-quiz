import {
  normalizeArchive,
  normalizeSentence,
  unwrapEnvelope,
  type DailyArchive,
  type DailySentence,
} from './sentence';

/**
 * 每日推送上游拉取（仅服务端调用）
 * ============================================================================
 * 三个接口（实测确认）：
 *
 *   GET /english-sentence                今日（可加 `?date=YYYY-MM-DD` 取指定日）
 *   GET /english-sentence/random         随机一条
 *   GET /english-sentence/list?page=&pageSize=   往期分页（count=5162）
 *
 * 三条纪律：
 *  1. **永不抛错**。上游挂了不该让页面 500 —— 这几个接口是第三方个人服务，
 *     抖动是常态。失败统一返回 `{ ok: false, reason }`，页面照常渲染空态。
 *  2. **不在浏览器里直连**。上游没有 CORS 保障，而且把第三方域名写进前端
 *     等于把可用性押在别人身上。全部走服务端（页面 ISR + 自己的 /api/daily 代理）。
 *  3. **超时必须短**。构建期一次挂起 8 秒会拖慢整次部署，所以显式给 AbortSignal。
 *     （Next 的服务端 fetch 没有默认超时。）
 */

const BASE = 'https://api.timelessq.com/english-sentence';
const TIMEOUT_MS = 8_000;

/** 今日推送的缓存时长：上游每天 0 点更新，30 分钟足够且能兜住抖动 */
const REVALIDATE_TODAY = 1_800;
/** 随机一条：页面渲染时用缓存（否则每次访问都要打上游），「换一句」走代理取实时 */
const REVALIDATE_RANDOM = 300;
/** 往期是历史数据，基本不变 */
const REVALIDATE_ARCHIVE = 3_600;

export type DailyResult<T> = { ok: true; data: T } | { ok: false; reason: string };

type CacheMode = { revalidate: number } | { fresh: true };

async function getJson(url: string, mode: CacheMode): Promise<DailyResult<unknown>> {
  /*
   * 一次重试。
   *
   * 实测：某次 Vercel 构建时该接口恰好不可达，于是 /daily 三个面板与首页的
   * 「每日一句」横条**同时变空**，而十几分钟后接口完全正常 —— 典型的瞬时抖动。
   * 构建期只试一次的话，这次抖动会被固化进 ISR 缓存最长半小时；
   * 重试一次的成本（400ms）远低于一个空页面的代价。
   */
  let lastReason = 'upstream-unreachable';
  for (let attempt = 0; attempt < 2; attempt++) {
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      // `fresh` 走 no-store（只在 route handler 里用，页面若混用会强制整页变动态）
      ...('fresh' in mode
        ? { cache: 'no-store' as const }
        : { next: { revalidate: mode.revalidate } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      lastReason = `upstream-${res.status}`;
    } else {
      // 上游统一信封 `{errno,errmsg,data}`，必须在这里拆掉（见 unwrapEnvelope 的注释）
      return unwrapEnvelope(await res.json());
    }
  } catch (e) {
    // 超时/断网/JSON 坏：都归为「这次没取到」，页面走空态
    const msg = e instanceof Error ? e.name : 'unknown';
    lastReason = msg === 'TimeoutError' ? 'upstream-timeout' : 'upstream-unreachable';
  }
  // 只重试一次：抖动是主要故障模式，重试成本（400ms）远低于空页面
  if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
  }
  return { ok: false, reason: lastReason };
}

function one(raw: DailyResult<unknown>): DailyResult<DailySentence> {
  if (!raw.ok) return raw;
  const data = normalizeSentence(raw.data);
  return data ? { ok: true, data } : { ok: false, reason: 'payload-unrecognized' };
}

/** 指定日期的推送（不传 = 今日） */
export async function fetchSentence(date?: string): Promise<DailyResult<DailySentence>> {
  const url = date ? `${BASE}?date=${encodeURIComponent(date)}` : BASE;
  return one(await getJson(url, { revalidate: REVALIDATE_TODAY }));
}

/** 随机一条（页面用；缓存 5 分钟，避免每次访问都打上游） */
export async function fetchRandom(): Promise<DailyResult<DailySentence>> {
  return one(await getJson(`${BASE}/random`, { revalidate: REVALIDATE_RANDOM }));
}

/** 随机一条（「换一句」用；实时，不缓存） */
export async function fetchRandomFresh(): Promise<DailyResult<DailySentence>> {
  return one(await getJson(`${BASE}/random`, { fresh: true }));
}

export const ARCHIVE_PAGE_SIZE = 20;

/** 往期分页 */
export async function fetchArchive(
  page: number,
  pageSize = ARCHIVE_PAGE_SIZE,
): Promise<DailyResult<DailyArchive>> {
  const p = Math.max(1, Math.floor(Number(page) || 1));
  const raw = await getJson(`${BASE}/list?page=${p}&pageSize=${pageSize}`, {
    revalidate: REVALIDATE_ARCHIVE,
  });
  if (!raw.ok) return raw;
  return { ok: true, data: normalizeArchive(raw.data, p, pageSize) };
}
