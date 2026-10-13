// tools/skin-library/used-operators.mjs — which of the client's operators this project actually uses.
//
// The client holds every operator in the game; the remake fields a subset. Two lists decide it, and neither is the
// skin catalogue (which is a hand-maintained research table and is why the 自选编队 skins were invisible):
//
//   data/chess.json          the operators a match can field (the roster)
//   data/backups.json  diy   the 自选编队 pool: `ownedPool` (every operator a player may own) and `prototypes`
//
// An operator in either list is "used". Report the split against the extracted library, so the gap between "what the
// client has" and "what the project needs" is a number rather than a guess.
//
//   node tools/skin-library/used-operators.mjs [--index <file>] [--json]

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_INDEX = 'tools/skin-library/library-index.json';

/**
 * The operator a library entry belongs to, from the entry itself.
 *
 * The index carries `charId` on every entry (the extractor knows it — it reads one bundle per operator), so nothing
 * has to be parsed back out of an id here. `id` is the client's own name (`char_017_huang_witch#5`) and `skinId` its
 * catalogue form (`char_017_huang@witch#5`), null for a default appearance or a summon.
 * @param {unknown} entry
 */
export function operatorOf(entry) {
  return (entry && typeof entry === 'object' && entry.charId) || null;
}

/**
 * The operators the project fields.
 * @param {{chess: any, backups: any}} data parsed data/chess.json and data/backups.json
 * @returns {{roster: string[], diy: string[], used: string[]}}
 */
export function usedOperators({ chess, backups }) {
  const roster = new Set();
  for (const v of Object.values(chess || {})) {
    if (v && v.charId && !v.isDiy && !v.isGolden) roster.add(v.charId);
  }
  const diy = new Set();
  const d = backups?.diy || {};
  for (const c of d.ownedPool || []) diy.add(c);
  for (const list of Object.values(d.prototypes || {})) for (const c of list || []) diy.add(c);
  return { roster: [...roster].sort(), diy: [...diy].sort(), used: [...new Set([...roster, ...diy])].sort() };
}

/**
 * Library coverage of `used`, per tier, plus the skins each tier can serve for those operators.
 * @param {Record<string, Record<string, any>>} tiers library-index `tiers`
 * @param {string[]} used
 */
export function coverage(tiers, used) {
  const wanted = new Set(used);
  const out = {};
  for (const [tier, map] of Object.entries(tiers)) {
    const entries = Object.values(map);
    const owners = new Set(entries.map(operatorOf).filter(Boolean));
    const have = used.filter((c) => owners.has(c));
    const skins = new Set();
    for (const e of entries) {
      if (e && e.skinId && wanted.has(e.charId)) skins.add(e.skinId);
    }
    out[tier] = {
      total: entries.length,
      operators: owners.size,
      covered: have.length,
      missing: used.filter((c) => !owners.has(c)),
      skins: [...skins].sort(),
    };
  }
  return out;
}

function main(argv) {
  let indexFile = DEFAULT_INDEX;
  let asJson = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--index') indexFile = argv[++i];
    else if (argv[i] === '--json') asJson = true;
    else throw new Error(`unknown option ${argv[i]}\nusage: node tools/skin-library/used-operators.mjs [--index <file>] [--json]`);
  }
  const read = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
  const { roster, diy, used } = usedOperators({ chess: read('data/chess.json'), backups: read('data/backups.json') });
  const index = read(indexFile);
  const cov = coverage(index.tiers || {}, used);
  if (asJson) {
    console.log(JSON.stringify({ counts: { roster: roster.length, diy: diy.length, used: used.length }, coverage: cov }, null, 1));
    return 0;
  }
  console.log(`项目使用的干员: ${used.length}（可上场 ${roster.length} + 自选池 ${diy.length}）`);
  for (const [tier, c] of Object.entries(cov)) {
    console.log(`  ${tier.padEnd(9)} 库内 ${String(c.total).padStart(5)} 张 / ${String(c.operators).padStart(4)} 名干员` +
      `   覆盖项目干员 ${c.covered}/${used.length}   可服务皮肤 ${c.skins.length}` + (c.missing.length ? `   缺 ${c.missing.length}` : ''));
    for (const m of c.missing.slice(0, 8)) console.log(`      缺 ${m}`);
  }
  const byTier = Object.fromEntries(Object.entries(cov).map(([t, c]) => [t, c.skins]));
  const union = new Set(Object.values(byTier).flat());
  console.log(`\n并集可服务皮肤: ${union.size}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`used-operators: ${e.message}`);
    process.exitCode = 2;
  }
}
