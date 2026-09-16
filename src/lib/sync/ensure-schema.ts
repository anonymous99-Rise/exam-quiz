/**
 * 进度表的「自愈」建表
 * ============================================================================
 * 为什么要在运行时建表：
 *   Vercel 的 Supabase 集成把连接串注入成 **Secret 类型** —— 值不可被 `vercel env pull`
 *   读出，也无法在本地直连执行 DDL。而 PostgREST 只能读写数据、不能建表。
 *   于是让应用自己在**首次同步时**建一次表：幂等（`if not exists`）、只跑一次、
 *   失败不阻塞（真出错时由 Supabase 调用返回具体错误）。
 *
 * 与 supabase/schema.sql 的关系：两边是同一份 DDL。
 *   · supabase/schema.sql  给人看 / 手动执行 / 迁移时用
 *   · 本文件                 运行时自愈用
 *   改动一个务必同步另一个（两边都写了 `if not exists`，重复执行安全）。
 */
import pg from 'pg';

/** 建表 DDL（与 supabase/schema.sql 保持一致） */
const DDL = `
create table if not exists public.progress (
  user_id    text primary key,
  handle     text,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.progress enable row level security;
`;

export type EnsureResult = { ok: true; created: boolean } | { ok: false; error: string };

/**
 * 进程内缓存：同一实例只尝试一次（DDL 幂等，重复也只是浪费一次往返）。
 * 失败不缓存 —— 下次请求还可以再试（比如数据库临时不可达）。
 */
let ensured = false;

/** 连接串：优先用非池化直连（DDL 走 pgbouncer 偶有兼容问题），回退到池化 */
function connString(): string {
  return (
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    ''
  );
}

export async function ensureProgressTable(): Promise<EnsureResult> {
  if (ensured) return { ok: true, created: false };

  const conn = connString();
  if (!conn) {
    return { ok: false, error: 'no-postgres-url' };
  }

  const client = new pg.Client({
    connectionString: conn,
    // serverless 环境里连接开销敏感，且这里只跑一条 DDL
    connectionTimeoutMillis: 8000,
    // Supabase 要求 TLS；证书链在部分环境里校验失败，故不强制校验
    ssl: conn.includes('sslmode=disable') ? undefined : { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const before = await client.query(
      `select to_regclass('public.progress') is not null as exists`,
    );
    const created = !before.rows[0]?.exists;
    await client.query(DDL);
    ensured = true;
    return { ok: true, created };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await client.end().catch(() => {});
  }
}
