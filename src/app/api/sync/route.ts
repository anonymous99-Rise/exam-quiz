/**
 * 进度云同步接口
 * ============================================================================
 *   GET  /api/sync   → 拉取当前用户的快照（没登录 401 / 没接 Supabase 503）
 *   POST /api/sync   → 覆盖写入当前用户的快照
 *
 * 服务端**不做合并**：合并需要本地的完整快照，而本地只在浏览器里。
 * 所以流程是「客户端拉远端 → 与本地合并 → 推回合并结果」，
 * 服务端只当一根可靠的管子（写入前校验、限长、限体积）。
 *
 * 自愈：Supabase 集成注入的连接串是 Secret（本地拿不到、也没法手动跑 DDL），
 * 所以首次同步时由应用自己建表；建完刷新 PostgREST schema cache。
 * 若 REST 仍报「找不到表/缓存未命中」，则强制自愈后**重试一次**。
 */
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { auth } from '@/auth';
import {
  ensureProgressTable,
  looksLikeMissingTable,
  reloadPostgrestSchema,
  safeError,
} from '@/lib/sync/ensure-schema';
import { SYNC_TABLE, supabaseAdmin, syncEnabled } from '@/lib/sync/supabase';
import { MAX_SNAPSHOT_BYTES, zProgressSnapshot } from '@/lib/sync/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const disabled = () =>
  NextResponse.json({ ok: false, reason: 'sync-disabled' }, { status: 503 });
const unauthenticated = () =>
  NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 });

type QueryResult<T> = { data: T } | { error: string };

/** 建表自愈（失败不拦请求，交由后续查询报真实错误） */
async function heal(force = false): Promise<void> {
  const res = await ensureProgressTable(force);
  if (!res.ok) console.warn('[sync] 建表自愈失败:', res.step, res.error);
  else if (res.created) console.log('[sync] 已创建 public.progress 并刷新 PostgREST schema cache');
}

/**
 * 跑一次查询；若报「表不存在 / schema cache 未命中」，强制自愈后**退避重试**。
 *
 * 为什么是多次而不是一次：PostgREST 的 schema cache 刷新是**异步**的 ——
 * 线上实测「建表成功、表也在」，但紧接着的 REST 查询仍报 schema cache 找不到表
 * （缓存还在用旧快照）。等几百毫秒再试就好了。
 */
const RETRY_DELAYS_MS = [350, 1000, 2000];

async function withHeal<T>(
  run: (
    sb: SupabaseClient,
  ) => PromiseLike<{ data: T | null; error: { message: string } | null }>,
): Promise<QueryResult<T>> {
  const sb = supabaseAdmin();
  if (!sb) return { error: 'sync-disabled' };

  let { data, error } = await run(sb);
  if (!error) return { data: data as T };
  if (!looksLikeMissingTable(error.message)) return { error: safeError(error.message) };

  await ensureProgressTable(true);
  for (const delay of RETRY_DELAYS_MS) {
    await reloadPostgrestSchema();
    await new Promise((r) => setTimeout(r, delay));
    ({ data, error } = await run(sb));
    if (!error) return { data: data as T };
    if (!looksLikeMissingTable(error.message)) break;
  }
  return { error: safeError(error?.message ?? 'unknown') };
}

export async function GET() {
  if (!syncEnabled) return disabled();

  const session = await auth();
  const uid = session?.user?.id;
  if (!uid) return unauthenticated();

  await heal();

  const res = await withHeal<{ data: unknown; updated_at: string } | null>((sb) =>
    sb.from(SYNC_TABLE).select('data, updated_at').eq('user_id', uid).maybeSingle(),
  );

  if ('error' in res) {
    return NextResponse.json(
      { ok: false, reason: 'db-error', message: res.error },
      { status: 500 },
    );
  }

  // 校验后再回传：数据库里若混进旧版/异常结构，读侧不至于崩
  const parsed = zProgressSnapshot.safeParse(res.data?.data ?? null);
  return NextResponse.json({
    ok: true,
    data: parsed.success ? parsed.data : null,
    updatedAt: res.data?.updated_at ?? null,
  });
}

export async function POST(req: Request) {
  if (!syncEnabled) return disabled();

  const session = await auth();
  const uid = session?.user?.id;
  if (!uid) return unauthenticated();

  const raw = await req.text();
  if (raw.length > MAX_SNAPSHOT_BYTES) {
    return NextResponse.json({ ok: false, reason: 'too-large' }, { status: 413 });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad-json' }, { status: 400 });
  }

  const parsed = zProgressSnapshot.safeParse((json as { data?: unknown })?.data ?? json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: 'bad-shape' }, { status: 400 });
  }

  await heal();

  const updatedAt = new Date().toISOString();
  const res = await withHeal<null>((sb) =>
    sb
      .from(SYNC_TABLE)
      .upsert(
        {
          user_id: uid,
          handle: session?.user?.login ?? session?.user?.name ?? null,
          data: parsed.data,
          updated_at: updatedAt,
        },
        { onConflict: 'user_id' },
      )
      .select('user_id')
      .maybeSingle(),
  );

  if ('error' in res) {
    return NextResponse.json(
      { ok: false, reason: 'db-error', message: res.error },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, updatedAt });
}
