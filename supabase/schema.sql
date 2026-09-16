-- ============================================================================
-- 进度云同步表（Supabase / Postgres）
-- ----------------------------------------------------------------------------
-- 用法（两种都行）：
--   1. Supabase 控制台 → SQL Editor → 粘贴执行
--   2. node tools/supabase-init.mjs          # 用 POSTGRES_URL 直连执行（CI/脚本）
--
-- 设计：一人一行 JSONB 快照。
--   为什么不是「一题一行」：合并逻辑在客户端（需要本地全量快照才能按条目合并），
--   服务端只当可靠的管子，单行快照让读写都是一次往返，且天然幂等（upsert）。
--   为什么 user_id 是 text：主键取 GitHub 数值 id 的字符串形式，不依赖任何本地用户表。
-- ============================================================================

create table if not exists public.progress (
  user_id    text primary key,
  handle     text,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.progress is '刷题进度快照：一行一个用户，由 /api/sync 读写';
comment on column public.progress.user_id is 'GitHub 数值 id（字符串）';
comment on column public.progress.handle  is 'GitHub 登录名，仅用于排查';
comment on column public.progress.data    is 'ProgressState 快照（answers/wrong/fav/off/drafts/positions/submitted）';

-- 只有服务端（service_role）会访问它：
--   开启 RLS 且**不建任何 policy** → anon / authenticated 角色的直连一律被拒，
--   service_role 绕过 RLS 正常工作。这样即便 anon key 泄露也读不到任何人的进度。
alter table public.progress enable row level security;

-- 排查用：看最近有谁同步过（在 SQL Editor 里执行，不会泄露进度内容）
-- select user_id, handle, updated_at, pg_size_pretty(length(data::text)::bigint) as size
--   from public.progress order by updated_at desc limit 20;
