// 一次性修补：把「超限改回在线源」时丢掉的 sharedWith 注记补回来
import fs from 'node:fs';

const file = 'content/cet6/assets.json';
const assets = JSON.parse(fs.readFileSync(file, 'utf8'));

/* 素材库注记：这些套卷共用前面某一套的音频（tools/assets-audio.mjs 里同一份表） */
const SHARES = {
  '2022-12-3': { with: '2022-12-1', note: '素材库注记：第3套听力与第2套或第1套完全相同' },
  '2023-06-3': { with: '2023-06-1', note: '素材库注记：第3套听力与第2套或第1套完全相同' },
  '2024-12-3': { with: '2024-12-1', note: '素材库注记：全国考试音频是2套，第3套与前面两套共用' },
};

let fixed = 0;
for (const [paperId, rule] of Object.entries(SHARES)) {
  const a = assets[paperId]?.audio;
  if (!a) continue;
  if (a.sharedWith === rule.with) continue;
  a.sharedWith = rule.with;
  if (!a.note) a.note = rule.note;
  fixed++;
  console.log(`✓ ${paperId} 补回 sharedWith=${rule.with}`);
}
if (fixed) fs.writeFileSync(file, JSON.stringify(assets, null, 2) + '\n');
console.log(fixed ? `已写入 ${file}` : '无需修补');
