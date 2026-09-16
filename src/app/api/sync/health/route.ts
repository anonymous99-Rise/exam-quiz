/**
 * 云同步自检端点
 * ============================================================================
 *   GET /api/sync/health
 *
 * 为什么需要它：Supabase 集成注入的连接串是 Secret 类型，`vercel env pull` 读不到值，
 * 外部也无法直连数据库。出问题时若只能看到前端一句「db-error」，排查全靠猜。
 * 这个端点把「环境变量是否齐 → 建表否成功 → 表是否存在 → REST 能否读到」四步
 * 逐段回传，于是**只要在浏览器打开这个地址**就能定位到具体哪一步断了。
 *
 * 安全：只回布尔值与脱敏后的错误串 —— 不回连接串、不回密钥、不回项目 URL。
 */
import { NextResponse } from 'next/server';

import { checkSchema, pgConnString, reloadPostgrestSchema } from '@/lib/sync/ensure-schema';
import { SYNC_TABLE, supabaseAdmin, supabaseServiceKey, supabaseUrl, syncEnabled } from '@/lib/sync/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const env = {
    syncEnabled,
    hasUrl: Boolean(supabaseUrl),
    hasServiceKey: Boolean(supabaseServiceKey),
    hasPgConn: Boolean(pgConnString()),
    // 只给「是不是非池化直连」，不给主机名
    pgIsDirect: /POSTGRES_URL_NON_POOLING|DATABASE_URL/.test(
      process.env.POSTGRES_URL_NON_POOLING
        ? 'POSTGRES_URL_NON_POOLING'
        : process.env.DATABASE_URL
          ? 'DATABASE_URL'
          : '',
    ),
    hasAuthSecret: Boolean(process.env.AUTH_SECRET),
    authEnabled: Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET),
  };

  if (!syncEnabled) {
    return NextResponse.json({ ok: false, reason: 'sync-disabled', env }, { status: 503 });
  }

  // 1) 建表 + 刷新 PostgREST schema cache；2) 核对表与列；3) 走 REST 读一行
  const schema = await checkSchema();

  let rest: { ok: boolean; error?: string; rows?: number; attempts?: number } = { ok: false };
  const sb = supabaseAdmin();
  if (sb) {
    /*
     * PostgREST 的 schema cache 刷新是异步的：表刚建好时第一次查询常报「找不到表」。
     * 这里退避重试几次，避免把「等一会儿就好」误报成故障。
     */
    for (let i = 0; i < 3; i++) {
      const { data, error } = await sb.from(SYNC_TABLE).select('user_id').limit(1);
      if (!error) {
        rest = { ok: true, rows: data?.length ?? 0, attempts: i + 1 };
        break;
      }
      rest = {
        ok: false,
        error: error.message.replace(/postgres(ql)?:\/\/[^\s]+/gi, 'postgres://***').slice(0, 300),
        attempts: i + 1,
      };
      if (!/schema cache|does not exist|PGRST205/i.test(error.message)) break;
      await reloadPostgrestSchema();
      await new Promise((r) => setTimeout(r, [350, 1000][i] ?? 1000));
    }
  }

  const ok = Boolean(schema.ddl.ok && schema.tableExists && rest.ok);
  return NextResponse.json(
    {
      ok,
      reason: ok ? 'healthy' : 'degraded',
      env,
      schema: {
        ddl: schema.ddl,
        via: schema.via,
        tableExists: schema.tableExists,
        tableError: schema.tableError ?? null,
        columnCount: schema.columnCount,
      },
      rest,
      hint: ok
        ? '云端同步链路正常'
        : '看 env / schema / rest 三段，哪段 ok=false 就是断点；把本响应原样发给我',
    },
    { status: ok ? 200 : 503 },
  );
}
