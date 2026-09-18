import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 清理 Vercel 历史部署（保留当前生产部署）
 *
 * 默认 **dry-run**：只打印将删除的清单。确认后加 `--delete` 才真删。
 * 只保留「最新的 READY 生产部署」—— 线上别名指向它，删了会站点失联。
 */
const TEAM = 'team_bRsCSnlHzxNQ6ghDTVBaILyA';
const PROJECT = 'prj_S7DmLSLUqIihse5zYczCz3kQNeIc';
const DO_DELETE = process.argv.includes('--delete');

const authPath = path.join(os.homedir(), 'AppData', 'Roaming', 'com.vercel.cli', 'Data', 'auth.json');
const token = JSON.parse(fs.readFileSync(authPath, 'utf8')).token;
if (!token) throw new Error('未取到 Vercel token');
const H = { authorization: `Bearer ${token}` };

async function api(url, init) {
  const res = await fetch(`https://api.vercel.com${url}`, { headers: H, ...init });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

const all = [];
let until = null;
for (;;) {
  const q = `/v6/deployments?projectId=${PROJECT}&teamId=${TEAM}&limit=100${until ? `&until=${until}` : ''}`;
  const page = await api(q);
  all.push(...page.deployments);
  until = page.pagination?.next ?? null;
  if (!until) break;
}

const when = (d) => new Date(d.created).toISOString().slice(5, 16).replace('T', ' ');
const readyProd = all
  .filter((d) => d.target === 'production' && d.state === 'READY')
  .sort((a, b) => b.created - a.created);
const keep = readyProd[0]?.uid;

console.log(`部署总数 ${all.length}`);
for (const d of all.slice(0, 5)) {
  console.log(`  最近: ${when(d)}  ${d.target ?? 'preview'}  ${d.state}  ${d.uid}  ${d.url}`);
}
console.log(`\n保留（当前生产）: ${keep}  ${when(readyProd[0] ?? { created: 0 })}`);
const victims = all.filter((d) => d.uid !== keep);
console.log(`待删除 ${victims.length} 个（其中生产 ${victims.filter((d) => d.target === 'production').length}，预览 ${victims.filter((d) => !d.target).length}）`);
console.log(`最早 ${when(victims.at(-1) ?? { created: 0 })} → 最新 ${when(victims[0] ?? { created: 0 })}`);

if (!DO_DELETE) {
  console.log('\n[dry-run] 加 --delete 才会真删。');
  process.exit(0);
}

let ok = 0;
let fail = 0;
for (const d of victims) {
  try {
    await api(`/v13/deployments/${d.uid}?teamId=${TEAM}`, { method: 'DELETE' });
    ok++;
    if (ok % 10 === 0) console.log(`  已删除 ${ok}/${victims.length}…`);
  } catch (e) {
    fail++;
    if (fail <= 3) console.log(`  删除失败 ${d.uid}: ${String(e).slice(0, 120)}`);
  }
}
console.log(`\n完成：删除 ${ok} 个，失败 ${fail} 个`);
