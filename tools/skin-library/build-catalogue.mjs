// tools/skin-library/build-catalogue.mjs — the skin catalogue, from the LOCAL CLIENT plus official names.
//
// The catalogue the skin picker reads (data/skins.json) used to come from docs/research/08-skins.json alone: a
// hand-maintained table of 174 skins on 115 operators, generated from three upstream repositories. It could not
// describe the 自选编队 pool, which fields operators outside the mode's roster (煌, 陈 …), so those operators offered
// only 默认 even though the client has their art.
//
// This rebuilds it from what the client actually holds:
//
//   which skins exist   tools/skin-library/library-index.json — written by `extract.py --only library`, one entry per
//                       operator image with the client's own `id`, its operator and the `skinId` it maps to
//   their names         .cache/gamedata/excel/skin_table.json (`charSkins[].displaySkin.skinName/.skinGroupName`) —
//                       the table docs/research/08-skins.json was generated from, verified to agree with it on all 174
//                       of its entries, so this only ADDS names for the skins it never listed
//
// A skin the name table does not know keeps the stem as its name, so it is still selectable. Images and models always
// come from the client; the name table is text only.
//
//   node tools/skin-library/build-catalogue.mjs [--offline] [--check]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { usedOperators } from './used-operators.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NAME_TABLE = '.cache/gamedata/excel/skin_table.json';

/** The catalogue shape data/skins.json has always had (tools/build-skins.mjs). */
export const CATALOGUE_VERSION = 1;

/**
 * The suffix the library index derives for a skin's SECOND official illustration.
 *
 * `charSkins[skinId]` in the official table carries two illustration ids: `illustId` and `spIllustId` (the 「sp」 差分
 * 立绘 — 4 skins upstream have one: 克洛丝 星月漂流记, 凯尔希 时遗, 阿米娅 于万千宇宙之中, 新约能天使 寻翼之歌). Only
 * one of those is a SKIN, so the extractor's `illust` tier lists the sp page under `<skinId>_sp` and this builder folds
 * it into the skin it belongs to instead of emitting a second entry (docs/SKINS.md).
 */
export const SP_ILLUSTR_SUFFIX = '_sp';

/**
 * Build the catalogue from the library index (pure; exported for tests).
 * @param {{tiers: Record<string, Record<string, any>>}} library parsed library-index.json
 * @param {{charSkins?: Record<string, any>}} [skinTable] parsed official skin_table.json, or null when unavailable
 * @param {string[]} used the operators the project fields
 * @returns {{doc: object, namesResolved: number, namesMissing: string[]}}
 */
export function buildCatalogue(library, skinTable, used) {
  const want = new Set(used);
  const charSkins = skinTable?.charSkins || {};
  // one skin can appear in several tiers (illust + portrait + avatar); the illust entry wins because it carries the
  // real page size, and a skin with no illustration still gets its entry from portrait/avatar
  const byId = new Map();
  for (const tier of ['illust', 'portrait', 'avatar']) {
    for (const entry of Object.values(library.tiers?.[tier] || {})) {
      if (!entry || !entry.skinId || !want.has(entry.charId)) continue;
      const prev = byId.get(entry.skinId);
      if (!prev || (prev.tier !== 'illust' && tier === 'illust')) byId.set(entry.skinId, { ...entry, tier });
    }
  }
  const namesMissing = [];
  // `<skinId>_sp` is not a skin (see SP_ILLUSTR_SUFFIX). Where the skin it belongs to is in the catalogue too, it is
  // folded into that skin's `spIllust` flag and dropped, which is what lets the picker's enlarged preview show both
  // official illustrations; an orphan sp page (no base entry) stays a row of its own rather than losing its art.
  const withSpIllust = new Set();
  for (const skinId of byId.keys()) {
    if (!skinId.endsWith(SP_ILLUSTR_SUFFIX)) continue;
    const base = skinId.slice(0, -SP_ILLUSTR_SUFFIX.length);
    if (byId.has(base)) withSpIllust.add(base);
  }
  const chars = {};
  for (const [skinId, entry] of [...byId].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (skinId.endsWith(SP_ILLUSTR_SUFFIX) && withSpIllust.has(skinId.slice(0, -SP_ILLUSTR_SUFFIX.length))) continue;
    const display = charSkins[skinId]?.displaySkin || {};
    // `<skinId>_sp` borrows the base skin's name where it stays a row of its own; it has no official entry.
    const base = charSkins[skinId.replace(/_sp$/, '')]?.displaySkin || {};
    let name = display.skinName || base.skinName || null;
    if (!name) { name = entry.id || skinId; namesMissing.push(skinId); }
    (chars[entry.charId] ||= []).push({ id: skinId, name, group: display.skinGroupName || base.skinGroupName || '',
      ...(withSpIllust.has(skinId) ? { spIllust: true } : null) });
  }
  const total = Object.values(chars).reduce((a, v) => a + v.length, 0);
  return {
    doc: { version: CATALOGUE_VERSION, counts: { chars: Object.keys(chars).length, skins: total }, chars },
    namesResolved: total - namesMissing.length,
    namesMissing,
  };
}

function main(argv) {
  let offline = false;
  let check = false;
  for (const a of argv) {
    if (a === '--offline') offline = true;
    else if (a === '--check') check = true;
    else throw new Error(`unknown option ${a}\nusage: node tools/skin-library/build-catalogue.mjs [--offline] [--check]`);
  }
  const read = (p) => (existsSync(path.join(ROOT, p)) ? JSON.parse(readFileSync(path.join(ROOT, p), 'utf8')) : null);
  const library = read('tools/skin-library/library-index.json');
  if (!library) throw new Error('tools/skin-library/library-index.json missing — run `node tools/setup.mjs --local` or extract.py --only library');
  const skinTable = read(NAME_TABLE);
  if (!skinTable) {
    if (offline) console.warn(`build-catalogue: ${NAME_TABLE} unavailable — every skin keeps its client id as its name`);
    else console.warn(`build-catalogue: ${NAME_TABLE} unavailable; fetch it with build-data (tools/assets/cache.mjs) for real names`);
  }
  const { used } = usedOperators({ chess: read('data/chess.json'), backups: read('data/backups.json') });
  const { doc, namesResolved, namesMissing } = buildCatalogue(library, skinTable, used);
  const text = `${JSON.stringify(doc, null, 1)}\n`;
  const out = path.join(ROOT, 'data/skins.json');
  if (check) {
    const old = existsSync(out) ? readFileSync(out, 'utf8') : null;
    if (old !== text) { console.error('build-catalogue: data/skins.json is out of date (run node tools/skin-library/build-catalogue.mjs)'); return 1; }
    console.log(`build-catalogue: data/skins.json is up to date (${doc.counts.skins} skins, ${doc.counts.chars} operators)`);
    return 0;
  }
  writeFileSync(out, text);
  console.log(`build-catalogue: ${doc.counts.skins} skins / ${doc.counts.chars} operators → data/skins.json` +
    `  (named ${namesResolved}, id-only ${namesMissing.length})`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`build-catalogue: ${e.message}`);
    process.exitCode = 2;
  }
}
