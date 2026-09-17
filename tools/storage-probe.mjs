// Supabase Storage 能力探测：bucket 能否建、public 桶能不能读、单文件上限多大
import fs from 'node:fs';

const env = fs.readFileSync('.env.local', 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm')) ?? [])[1];
const URL_ = get('SUPABASE_URL');
const KEY = get('SUPABASE_SERVICE_ROLE_KEY');
if (!URL_ || !KEY) {
  console.error('✗ .env.local 缺 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
console.log('项目:', URL_);
const H = { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };

/* 1) 现有 bucket */
const list = await fetch(`${URL_}/storage/v1/bucket`, { headers: H });
const buckets = await list.json().catch(() => null);
console.log('现有 bucket:', JSON.stringify(buckets));

/* 2) 建/确保 public 桶 audio */
let mk = await fetch(`${URL_}/storage/v1/bucket`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ id: 'audio', name: 'audio', public: true }),
});
let mkBody = await mk.text();
console.log('建桶 audio:', mk.status, mkBody.slice(0, 200));
if (mk.status === 409) console.log('  （已存在，继续）');

/* 3) 读回桶配置，看 file_size_limit */
const one = await fetch(`${URL_}/storage/v1/bucket/audio`, { headers: H });
console.log('桶配置:', one.status, JSON.stringify(await one.json().catch(() => null)));

/* 4) 上传一个小文件测通 */
const small = Buffer.from('probe');
let up = await fetch(`${URL_}/storage/v1/object/audio/__probe.txt`, {
  method: 'POST',
  headers: { ...H, 'content-type': 'text/plain', 'x-upsert': 'true' },
  body: small,
});
console.log('上传探测文件:', up.status, (await up.text()).slice(0, 200));

/* 5) 公开读 + Range 支持 */
const pub = `${URL_}/storage/v1/object/public/audio/__probe.txt`;
const r1 = await fetch(pub);
console.log('公开读:', r1.status, await r1.text());
const r2 = await fetch(pub, { headers: { Range: 'bytes=0-1' } });
console.log('Range 请求:', r2.status, 'content-range=' + r2.headers.get('content-range'), 'accept-ranges=' + r2.headers.get('accept-ranges'));

/* 6) 探测单文件上限：试着上传 51MB 的零数据 */
const big = Buffer.alloc(51 * 1024 * 1024, 0);
const r3 = await fetch(`${URL_}/storage/v1/object/audio/__probe51.bin`, {
  method: 'POST',
  headers: { ...H, 'content-type': 'application/octet-stream', 'x-upsert': 'true' },
  body: big,
});
console.log('上传 51MB:', r3.status, (await r3.text()).slice(0, 300));

/* 清理 */
for (const p of ['__probe.txt', '__probe51.bin']) {
  await fetch(`${URL_}/storage/v1/object/audio/${p}`, { method: 'DELETE', headers: H });
}
console.log('已清理探测文件');
