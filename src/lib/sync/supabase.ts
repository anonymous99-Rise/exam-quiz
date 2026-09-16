/**
 * Supabase 服务端客户端（仅服务端使用）
 * ============================================================================
 * ⚠ 用的是 **service_role key**，它会绕过 RLS —— 绝对不能出现在客户端 bundle 里，
 * 所以本文件只被 route handler 引用，且只读 `process.env`（不带 NEXT_PUBLIC_）。
 *
 * 环境变量兼容两种来源：
 *   - Vercel 的 Supabase 集成：`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
 *   - 手工配置：`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SYNC_TABLE = 'progress';

export const supabaseUrl =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? '';

/** 云同步是否可用（没接 Supabase 时为 false，接口返回 503，前端隐藏同步入口） */
export const syncEnabled = Boolean(supabaseUrl && supabaseServiceKey);

let cached: SupabaseClient | null = null;

/** 服务端 Supabase 客户端（单例；未配置时返回 null） */
export function supabaseAdmin(): SupabaseClient | null {
  if (!syncEnabled) return null;
  cached ??= createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
