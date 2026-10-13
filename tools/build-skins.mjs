// tools/build-skins.mjs — data/skins.json, delegated to the client-driven generator.
//
// This file used to build the catalogue from docs/research/08-skins.json alone: 174 skins on 115 operators — only the
// skins that hand-maintained table knew about. The catalogue is now generated from what the LOCAL CLIENT holds
// (tools/skin-library/library-index.json, written by `extract.py --only library`), which covers the 自选编队 pool's
// operators too (煌, 陈, 凯尔希 …): 275 skins on 174 operators. Two generators writing one path is a trap — running the
// old one silently reverted the catalogue and nothing failed — so this is now a thin wrapper that refuses to do that.
//
//   node tools/build-skins.mjs          # → tools/skin-library/build-catalogue.mjs
//
// See docs/SKINS.md.

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENERATOR = path.join('tools', 'skin-library', 'build-catalogue.mjs');
const LIBRARY = path.join(ROOT, 'tools', 'skin-library', 'library-index.json');

if (!existsSync(LIBRARY)) {
  console.error(`build-skins: ${path.relative(ROOT, LIBRARY)} is missing.`);
  console.error('  The catalogue is built from the extracted client library now, so run the extraction first:');
  console.error('    node tools/setup.mjs --local           (or: extract.py --only library)');
  console.error('  docs/research/08-skins.json is still used for skin names and the mirror URLs, not for the catalogue.');
  process.exit(2);
}

console.log(`build-skins: delegating to ${GENERATOR} (the catalogue comes from the client library now)`);
const r = spawnSync(process.execPath, [GENERATOR, ...process.argv.slice(2)], { cwd: ROOT, stdio: 'inherit' });
process.exit(r.status ?? 2);
