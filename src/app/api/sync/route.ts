/**
 * 进度云同步接口
 * ============================================================================
 *   GET  /api/sync   → 拉取当前用户的快照（没登录 401 / 没接 Supabase 503）
 *   POST /api/sync   → 覆盖写入当前用户的快照
 *
 * 服务端**不做合并**：合并需要本地的完整快照，而本地只在浏览器里。
 * 所以流程是「客户端拉远端 → 与本地合并 → 推回合并结果」，
 * 服务端只当一根可靠的管子（写入前校验、限长、限体积）。
 */
import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { SYNC_TABLE, supabaseAdmin, syncEnabled } from '@/lib/sync/supabase';
import { MAX_SNAPSHOT_BYTES, zProgressSnapshot } from '@/lib/sync/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const disabled = () =>
  NextResponse.json({ ok: false, reason: 'sync-disabled' }, { status: 503 });
const unauthenticated = () =>
  NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 });

export async function GET() {
  if (!syncEnabled) return disabled();

  const session = await auth();
  const uid = session?.user?.id;
  if (!uid) return unauthenticated();

  const sb = supabaseAdmin();
  if (!sb) return disabled();

  const { data, error } = await sb
    .from(SYNC_TABLE)
    .select('data, updated_at')
    .eq('user_id', uid)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, reason: 'db-error', message: error.message },
      { status: 500 },
    );
  }

  // 校验后再回传：数据库里若混进旧版/异常结构，读侧不至于崩
  const parsed = zProgressSnapshot.safeParse(data?.data ?? null);
  return NextResponse.json({
    ok: true,
    data: parsed.success ? parsed.data : null,
    updatedAt: (data?.updated_at as string | undefined) ?? null,
  });
}

export async function POST(req: Request) {
  if (!syncEnabled) return disabled();

  const session = await auth();
  const uid = session?.user?.id;
  if (!uid) return unauthenticated();

  const sb = supabaseAdmin();
  if (!sb) return disabled();

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

  const updatedAt = new Date().toISOString();
  const { error } = await sb.from(SYNC_TABLE).upsert(
    {
      user_id: uid,
      handle: session?.user?.login ?? session?.user?.name ?? null,
      data: parsed.data,
      updated_at: updatedAt,
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    return NextResponse.json(
      { ok: false, reason: 'db-error', message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, updatedAt });
}
