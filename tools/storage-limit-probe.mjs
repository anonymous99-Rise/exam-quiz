// 能不能把单文件上限抬到 100MB（两个 66MB 的 mp3 需要）
import fs from 'node:fs';

const env = fs.readFileSync('.env.local', 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm')) ?? [])[1];
const U = get('SUPABASE_URL');
const K = get('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: K, authorization: `Bearer ${K}`, 'content-type': 'application/json' };

const put = await fetch(`${U}/storage/v1/bucket/audio`, {
  method: 'PUT',
  headers: H,
  body: JSON.stringify({ public: true, file_size_limit: 104857600 }),
});
console.log('设置 bucket file_size_limit=100MB:', put.status, (await put.text()).slice(0, 200));

const back = await fetch(`${U}/storage/v1/bucket/audio`, { headers: H });
console.log('桶配置:', JSON.stringify(await back.json()));

const big = Buffer.alloc(51 * 1024 * 1024, 0);
const up = await fetch(`${U}/storage/v1/object/audio/__probe51.bin`, {
  method: 'POST',
  headers: { ...H, 'content-type': 'application/octet-stream', 'x-upsert': 'true' },
  body: big,
});
console.log('再传 51MB:', up.status, (await up.text()).slice(0, 200));
await fetch(`${U}/storage/v1/object/audio/__probe51.bin`, { method: 'DELETE', headers: H });
