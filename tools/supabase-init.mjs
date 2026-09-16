#!/usr/bin/env node
/**
 * supabase-init.mjs — 把 supabase/schema.sql 应用到 Supabase 数据库
 * ============================================================================
 * 为什么需要它：Supabase 的 REST（PostgREST）只能读写数据，**不能执行 DDL**；
 * 建表要么在控制台 SQL Editor 里点，要么用 Postgres 连接串直连。
 * 本脚本走后者，方便在部署流水线里一次搞定。
 *
 * 连接串来源（按优先级）：
 *   --url <conn>           显式传入
 *   $POSTGRES_URL           Vercel 的 Supabase 集成注入
 *   $DATABASE_URL           常见别名
 *   $SUPABASE_DB_URL        常见别名
 *
 * 用法：
 *   node tools/supabase-init.mjs                    # 用环境变量里的连接串
 *   node tools/supabase-init.mjs --url "postgres://..." --dry
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const sqlFile = value('--file') ?? path.join(PROJECT, 'supabase', 'schema.sql');
const conn =
  value('--url') ??
  process.env.POSTGRES_URL ??
  process.env.DATABASE_URL ??
  process.env.SUPABASE_DB_URL ??
  '';

const sql = fs.readFileSync(sqlFile, 'utf8');

if (flag('--dry')) {
  console.log(`（--dry）将执行 ${path.relative(PROJECT, sqlFile)}，${sql.length} 字符：\n`);
  console.log(sql);
  process.exit(0);
}

if (!conn) {
  console.error('✗ 没有数据库连接串。请给 --url，或设置 POSTGRES_URL / DATABASE_URL。');
  console.error('  Vercel 集成注入的连接串可以用 `vercel env pull .env.local` 拿到。');
  process.exit(2);
}

// 连接串里可能带密码 → 出错时不要把整串打出来
const masked = conn.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@');
console.log(`→ 连接 ${masked}`);
console.log(`→ 执行 ${path.relative(PROJECT, sqlFile)}`);

const client = new pg.Client({
  connectionString: conn,
  // Supabase 的池化连接（pgbouncer）不接受预处理语句
  ...(conn.includes('pgbouncer') || conn.includes(':6543') ? {} : {}),
});

try {
  await client.connect();
  await client.query(sql);
  const { rows } = await client.query(
    `select column_name, data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'progress'
      order by ordinal_position`,
  );
  if (!rows.length) {
    console.error('✗ 执行完成但没看到 public.progress 表，请检查 SQL。');
    process.exitCode = 1;
  } else {
    console.log('✓ public.progress 就绪：');
    for (const r of rows) console.log(`    ${r.column_name}  ${r.data_type}`);
    const { rows: rls } = await client.query(
      `select relrowsecurity from pg_class where oid = 'public.progress'::regclass`,
    );
    console.log(`  RLS 已启用：${rls[0]?.relrowsecurity ? '是' : '否（应开启）'}`);
  }
} catch (e) {
  console.error(`✗ 失败：${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
