// Supabase Storage 公开对象是否给 CORS 头（决定 HLS 能不能让浏览器直连）
import fs from 'node:fs';
const env = fs.readFileSync('.env.local', 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm')) ?? [])[1];
const U = get('SUPABASE_URL');
const K = get('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: K, authorization: `Bearer ${K}`, 'content-type': 'text/plain' };

await fetch(`${U}/storage/v1/object/audio/__probe.txt`, { method: 'POST', headers: { ...H, 'x-upsert': 'true' }, body: 'x' });

const pub = `${U}/storage/v1/object/public/audio/__probe.txt`;
for (const label of ['不带 Origin', '带 Origin']) {
  const r = await fetch(pub, {
    headers: label === '带 Origin' ? { Origin: 'https://exam-quiz-seven.vercel.app' } : {},
  });
  console.log(label, r.status, JSON.stringify({
    acao: r.headers.get('access-control-allow-origin'),
    acah: r.headers.get('access-control-allow-headers'),
    acam: r.headers.get('access-control-allow-methods'),
    cover: r.headers.get('access-control-expose-headers'),
    ct: r.headers.get('content-type'),
    cc: r.headers.get('cache-control'),
    etag: r.headers.get('etag'),
  }));
}
// 预检
const opt = await fetch(pub, {
  method: 'OPTIONS',
  headers: { Origin: 'https://exam-quiz-seven.vercel.app', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'range' },
});
console.log('OPTIONS 预检', opt.status, opt.headers.get('access-control-allow-origin'), opt.headers.get('access-control-allow-headers'));

await fetch(`${U}/storage/v1/object/audio/__probe.txt`, { method: 'DELETE', headers: H });
