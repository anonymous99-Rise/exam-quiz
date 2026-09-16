/**
 * 进度表的「自愈」建表 + 连通性自检
 * ============================================================================
 * 为什么要在运行时建表：
 *   Vercel 的 Supabase 集成把连接串注入成 **Secret 类型** —— 值不可被 `vercel env pull`
 *   读出，也无法在本地直连执行 DDL。而 PostgREST 只能读写数据、不能建表。
 *
 * ⚠ 关键坑（第一版线上就栽在这）：**建完表必须刷新 PostgREST 的 schema cache**，
 *   否则紧接着的 REST 查询仍会报「找不到表 / schema cache」，表现为 db-error。
 *   刷新方式：`notify pgrst, 'reload schema'`。
 *
 * 与 supabase/schema.sql 的关系：同一份 DDL。
 *   · supabase/schema.sql  给人看 / 手动执行 / 迁移用
 *   · 本文件                 运行时自愈 + 自检用
 */
import type pg from 'pg';

const DDL = `
create table if not exists public.progress (
  user_id    text primary key,
  handle     text,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.progress enable row level security;
-- 建表/改表后必须让 PostgREST 重新读一次 schema，否则 REST 侧仍说「找不到表」
notify pgrst, 'reload schema';
`;

export type EnsureResult = {
  ok: boolean;
  /** 本次调用是否真的新建了表 */
  created?: boolean;
  /** 成功时：用的是哪条连接（pooled / direct / database_url） */
  via?: string;
  /** 失败原因（已脱敏，可安全回传/记日志） */
  error?: string;
  /** 失败发生在哪一步 */
  step?: 'no-url' | 'connect' | 'ddl' | 'verify';
};

/** 连接串候选：池化在前（Supavisor 的证书链是正常 CA；直连是自签证书，且新项目常只给 IPv6） */
export function pgCandidates(): { label: string; url: string }[] {
  const list: { label: string; url: string }[] = [
    { label: 'pooled', url: process.env.POSTGRES_URL ?? '' },
    { label: 'direct', url: process.env.POSTGRES_URL_NON_POOLING ?? '' },
    { label: 'database_url', url: process.env.DATABASE_URL ?? '' },
  ];
  const seen = new Set<string>();
  return list.filter((c) => {
    if (!c.url || seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });
}

/** 兼容旧调用：仍返回首选的连接串 */
export function pgConnString(): string {
  return pgCandidates()[0]?.url ?? '';
}

/**
 * 去掉连接串里的 ssl 相关参数。
 *
 * 为什么必须去掉：`pg` 会解析连接串里的 `sslmode`，而新版语义下 `sslmode=require`
 * 会**开启证书校验**，覆盖我们显式传入的 `ssl` 配置 —— 线上实测报
 * 「self-signed certificate in certificate chain」（Supabase 直连用自签证书），
 * 于是建表这一步直接失败、表永远建不起来。
 * 我们改用显式的 ssl 选项来控制校验行为，不让连接串插手。
 */
function stripSslParams(conn: string): string {
  return conn
    .replace(/([?&])(sslmode|ssl|uselibpqcompat|sslrootcert)=[^&]*/gi, '$1')
    .replace(/[?&]+(&|$)/g, '$1')
    .replace(/[?&]$/, '');
}

/** TLS：Supabase 直连是自签证书，必须放宽校验（仅此连接、不入库任何数据） */
function sslFor(conn: string) {
  if (/sslmode=disable/i.test(conn)) return undefined;
  return { rejectUnauthorized: false, checkServerIdentity: () => undefined };
}

/** 进程内缓存：成功后不再重复尝试 */
let ensured = false;
/** 上次成功用的连接标签（自检端点回显，便于排查） */
let ensuredVia: string | null = null;
/**
 * 失败后的冷却时间：数据库不可达时，建表要等到连接超时（8s）。
 * 若每个同步请求都重试一次，用户每次同步都会被拖 8 秒才轮到 REST 兜底 ——
 * 所以同实例内失败后 60 秒内不再重试（force=true 不受限，用于「REST 说表不存在」）。
 */
const FAIL_COOLDOWN_MS = 60_000;
let lastFailAt = 0;

/** 把 Postgres/pg 的错误压成一句可安全外传的信息（不带连接串、不带凭据） */
export function safeError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m
    .replace(/postgres(ql)?:\/\/[^\s]+/gi, 'postgres://***')
    .replace(/(password|apikey|api_key)=[^\s&]+/gi, '$1=***')
    .slice(0, 300);
}

/**
 * pg 用**动态导入**：
 *   建表只是「自愈」路径，不是同步的必要条件（表已存在时 REST 直接可用）。
 *   若 pg 在某个 serverless 运行时里打包/加载异常，静态 import 会让整个
 *   /api/sync 直接 500 —— 那是把「可选优化」变成了「致命依赖」。
 */
let pgMod: typeof pg | null = null;
async function loadPg(): Promise<typeof pg> {
  pgMod ??= (await import('pg')).default;
  return pgMod;
}

async function withClient<T>(label: string, rawConn: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const { Client } = await loadPg();
  const conn = stripSslParams(rawConn);
  const client = new Client({
    connectionString: conn,
    connectionTimeoutMillis: 8000,
    statement_timeout: 8000,
    ssl: sslFor(rawConn),
  });
  try {
    await client.connect();
  } catch (e) {
    throw new Error(`[${label}] ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

/** 依次尝试各候选连接串，返回第一个成功的；全失败则抛出汇总错误 */
async function withFirstClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<{ value: T; label: string }> {
  const cands = pgCandidates();
  if (!cands.length) throw new Error('no-postgres-url');
  const errors: string[] = [];
  for (const c of cands) {
    try {
      const value = await withClient(c.label, c.url, fn);
      return { value, label: c.label };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(errors.join(' | '));
}

/**
 * 确保 public.progress 存在，并刷新 PostgREST 的 schema cache。
 * @param force 已成功后仍重新执行一次（用于「REST 说找不到表」时强制自愈）
 */
export async function ensureProgressTable(force = false): Promise<EnsureResult> {
  if (ensured && !force) return { ok: true, created: false };
  if (!force && Date.now() - lastFailAt < FAIL_COOLDOWN_MS) {
    return { ok: false, step: 'connect', error: 'cooldown-after-failure' };
  }

  if (!pgConnString()) return { ok: false, step: 'no-url', error: 'no-postgres-url' };

  try {
    // 回调只返回 boolean —— 不要把外层的 label 包进返回值，否则与解构变量互相引用
    const res = await withFirstClient(async (client) => {
      const before = await client.query(
        `select to_regclass('public.progress') is not null as exists`,
      );
      const existed = Boolean(before.rows[0]?.exists);
      await client.query(DDL);
      return !existed;
    });
    ensured = true;
    lastFailAt = 0;
    ensuredVia = res.label;
    return { ok: true, created: res.value, via: res.label };
  } catch (e) {
    lastFailAt = Date.now();
    return { ok: false, step: 'ddl', error: safeError(e) };
  }
}

/** 自检：表是否存在、REST 侧能否读到（供 /api/sync/health 使用） */
export async function checkSchema(): Promise<{
  ddl: EnsureResult;
  tableExists: boolean | null;
  tableError?: string;
  columnCount: number | null;
  via: string | null;
}> {
  const ddl = await ensureProgressTable(true);
  try {
    const info = await withFirstClient(async (client) => {
      const t = await client.query(`select to_regclass('public.progress') is not null as exists`);
      const cols = await client.query(
        `select count(*)::int as n from information_schema.columns
          where table_schema = 'public' and table_name = 'progress'`,
      );
      return { exists: Boolean(t.rows[0]?.exists), n: Number(cols.rows[0]?.n ?? 0) };
    });
    return {
      ddl,
      tableExists: info.value.exists,
      columnCount: info.value.n,
      via: ddl.via ?? info.label ?? ensuredVia,
    };
  } catch (e) {
    return { ddl, tableExists: null, tableError: safeError(e), columnCount: null, via: ddl.via ?? null };
  }
}

/**
 * 判断 Supabase/PostgREST 的错误是否属于「表还没建好 / schema cache 未刷新」。
 * 命中时上层应强制自愈并重试一次。
 */
export function looksLikeMissingTable(message: string | undefined): boolean {
  if (!message) return false;
  return /PGRST205|42P01|does not exist|schema cache|Could not find the table/i.test(message);
}
