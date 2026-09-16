// 数据一致性：校验器报出的缺口，是否都在 flags 里如实告知了用户
import fs from 'node:fs';

const dir = 'content/cet6/papers';
const ix = JSON.parse(fs.readFileSync('content/cet6/index.json', 'utf8'));
const byId = new Map(ix.papers.map((p) => [p.id, p]));
const missing = [];

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const id = f.replace('.json', '');
  const p = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
  const flags = new Set(p.flags ?? []);
  const idx = byId.get(id);

  // 1) 匹配题答案引用了不存在的段落 → 原文缺尾段
  for (const q of p.questions) {
    if (q.kind !== 'paragraph-match' || !q.passageId) continue;
    const psg = p.passages?.[q.passageId];
    if (!psg?.paragraphs) continue;
    const labels = new Set(psg.paragraphs.map((x) => x.label));
    if (q.answer && !labels.has(q.answer) && !flags.has('passage-truncated')) {
      missing.push({ id, why: `#${q.no} 答案 ${q.answer} 不在段落集合内，但 flags 没有 passage-truncated`, flags: [...flags] });
      break;
    }
  }

  // 2) 题号跳号 → missing-nos
  const nos = p.questions.map((q) => q.no).sort((a, b) => a - b);
  for (let i = 1; i < nos.length; i++) {
    if (nos[i] - nos[i - 1] > 1 && !flags.has('missing-nos')) {
      missing.push({ id, why: `题号 ${nos[i - 1]} → ${nos[i]} 跳号，但 flags 没有 missing-nos`, flags: [...flags] });
      break;
    }
  }

  // 3) flags 与 index.json 是否一致
  const idxFlags = new Set(idx?.flags ?? []);
  const onlyLocal = [...flags].filter((x) => !idxFlags.has(x));
  const onlyIndex = [...idxFlags].filter((x) => !flags.has(x));
  if (onlyLocal.length || onlyIndex.length) {
    missing.push({ id, why: `flags 与 index.json 不一致（仅 paper: ${onlyLocal}；仅 index: ${onlyIndex}）` });
  }
}

console.log(`检查 ${fs.readdirSync(dir).filter((x) => x.endsWith('.json')).length} 套`);
if (!missing.length) console.log('✅ 所有缺口都已在 flags 中如实告知');
else {
  console.log(`❌ ${missing.length} 处不一致：`);
  for (const m of missing) console.log('  ', m.id, '|', m.why);
}
