#!/usr/bin/env node
// tools/local-skins-meta.mjs — metadata of the operator skin models extracted from the local game client.
//
// The counterpart of tools/assets/local-enemy-spines.json / local-token-spines.json for skins: `localSpineMeta`
// (tools/assets/spine.mjs) reads the .skel/.atlas a previous `extract.py` run wrote under
// public/assets/local/spine/op/ and resolves the clips a unit plays, so the client gets a full Spine entry (anims,
// durations, bounds) exactly as the web manifest carries one. The result is committed; only the art is not.
//
//   node tools/local-skins-meta.mjs [--out <file>]
//
// Needs the extraction to have run (node tools/setup.mjs --local, or extract.py --only spine/op).

import { existsSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localSpineMeta, LOCAL_SPINE_ROLES } from './assets/spine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LOCAL_SKINS_META_FILE = 'tools/assets/local-skins-meta.json';
const LOCAL_SKIN_DIR = 'public/assets/local/spine/op';

/**
 * Front ⇄ Back correction, from the clips the client itself ships.
 *
 * `Die` (the fall an operator lies down with) exists on the FRONT model only: a knocked-out chibi is drawn facing the
 * camera, so the Back — which carries just the standing and walking set — never has it. That is a binary fact of the
 * game rather than a heuristic, and it is what decides the two facings here: the extraction finds two skeletons under
 * one asset name and cannot tell them apart by name or by bundle order, so `facings_of` guesses by byte size and this
 * corrects it. Measured over the 268 pairs: Die on the Front only 260, on the Back only 4 (corrected here), on both 3
 * and on neither 1 (those keep the size-based order, which the review confirmed for every one of them).
 *
 * The models are corrected by RENAMING THE DIRECTORIES, because the group paths the client reads are literally
 * `spine/op/<charId>/<stem>/{front,back}`: after the swap `data/local-assets.json` (rewritten by the extraction right
 * after this runs) points at the right art without knowing anything about the swap.
 *
 * @param {Record<string, any>} meta the metadata, keyed `<charId>/<stem>` with a `/back` suffix for the Back
 * @returns {string[]} the keys that were swapped
 */
function fixFacings(meta) {
  const swapped = [];
  for (const key of Object.keys(meta)) {
    if (key.endsWith('/back') || !meta[`${key}/back`]) continue;
    const front = meta[key].animations || {};
    const back = meta[`${key}/back`].animations || {};
    const has = (a, n) => Object.prototype.hasOwnProperty.call(a, n);
    if (has(front, 'Die') || !has(back, 'Die')) continue;   // already right, or the clip cannot tell
    const dirOf = (e) => path.dirname(String(e.skel));
    const a = dirOf(meta[key]);
    const b = dirOf(meta[`${key}/back`]);
    if (a === b || !existsSync(a) || !existsSync(b)) continue;
    try {
      renameSync(a, `${a}.swap`);
      renameSync(b, a);
      renameSync(`${a}.swap`, b);
    } catch (e) {
      console.log(`  warn ${key}: cannot swap the facing directories (${e.message})`);
      continue;
    }
    const f = meta[key];
    meta[key] = meta[`${key}/back`];
    meta[`${key}/back`] = f;
    swapped.push(key);
  }
  return swapped;
}

/**
 * Every extracted skin model under <root>/spine/op as `found` entries for localSpineMeta:
 * `{ [<charId>/<stem>]: { dir, skel, atlas, pngs } }`, `dir` relative to <root>.
 * @param {string} root absolute public/assets/local directory
 */
export function findLocalSkinModels(root = path.join(ROOT, 'public/assets/local')) {
  const base = path.join(root, 'spine/op');
  const found = {};
  if (!existsSync(base)) return found;
  for (const charId of readdirSync(base).sort()) {
    const charDir = path.join(base, charId);
    for (const stem of readdirSync(charDir).sort()) {
      for (const tag of ['front', 'back']) {
        const dir = path.join(charDir, stem, tag);
        if (!existsSync(dir)) continue;
        const files = readdirSync(dir);
        const skel = files.find((f) => f.endsWith('.skel'));
        const atlas = files.find((f) => f.endsWith('.atlas'));
        const pngs = files.filter((f) => f.endsWith('.png') || f.endsWith('.webp'));
        if (!skel || !atlas) continue;
        found[`${charId}/${stem}${tag === 'back' ? '/back' : ''}`] = {
          // localSpineMeta reads every path as root-relative plus these, so they are given absolute
          dir: `${dir}${path.sep}`, skel: path.join(dir, skel), atlas: path.join(dir, atlas), pngs: pngs.map((p) => path.join(dir, p)),
        };
      }
    }
  }
  return found;
}

async function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--out');
  const out = path.resolve(ROOT, i >= 0 && argv[i + 1] ? argv[i + 1] : LOCAL_SKINS_META_FILE);
  const found = findLocalSkinModels();
  if (!Object.keys(found).length) {
    console.error(`no extracted skin models under ${LOCAL_SKIN_DIR} — run extract.py --only spine/op first`);
    return 1;
  }
  // paths in `found` are absolute, and localSpineMeta joins every one onto this root — so it is the empty prefix
  const { meta, problems } = await localSpineMeta('', found);
  // Front ⇄ Back, decided by the client's own `Die` clip (see fixFacings) — before the file names are flattened, so
  // the directory swap is reflected in what gets written
  const swapped = fixFacings(meta);
  // localSpineMeta keys its entries by the absolute paths it read; only the file NAMES belong in a committed file, and
  // a path from this machine must never be committed (tools/package.mjs refuses a shipped file carrying one).
  const base = (p) => String(p).slice(String(p).replace(/\\/g, '/').lastIndexOf('/') + 1);
  for (const e of Object.values(meta)) {
    e.skel = base(e.skel);
    e.atlas = base(e.atlas);
    if (Array.isArray(e.textures)) e.textures = e.textures.map(base);
  }
  const doc = {
    version: 1,
    note: 'Metadata of the operator skin models extracted from the local game client (tools/local-skins-meta.mjs, '
      + 'tools/local-extract/extract.py `skins`). Keyed `<charId>/<stem>` (a `/back` suffix for the Back model); the '
      + 'art itself is never committed. Read by tools/local-extract to fill data/skins-local.json (docs/SKINS.md).',
    count: Object.keys(meta).length,
    roleFixes: Object.keys(LOCAL_SPINE_ROLES).filter((id) => meta[id]).length,
    models: meta,
  };
  writeFileSync(out, `${JSON.stringify(doc, null, 1)}\n`);
  console.log(`${Object.keys(meta).length} skin model(s) -> ${path.relative(ROOT, out)}`);
  if (swapped.length) {
    console.log(`  swapped Front ⇄ Back on ${swapped.length} model(s) (the client's Die clip is on the Front only):`);
    for (const k of swapped) console.log(`     ${k}`);
  }
  const touched = Object.keys(meta).filter((k) => LOCAL_SPINE_ROLES[k.replace(/\/back$/, '')] || LOCAL_SPINE_ROLES[k]);
  if (touched.length) console.log(`  role fixes applied to ${touched.length} model(s)`);
  for (const p of problems.slice(0, 20)) console.log(`  warn ${p}`);
  if (problems.length > 20) console.log(`  … ${problems.length - 20} more`);
  return problems.length ? 0 : 0;
}

function isMain() {
  try { return !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
}
if (isMain()) process.exit(await main());
