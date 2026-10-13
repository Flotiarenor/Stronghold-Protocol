// 干员皮肤目录 (docs/SKINS.md, tools/skin-library/build-catalogue.mjs): what data/skins.json is built from.
//
// The one thing this file pins is the difference between a SKIN and a skin's SECOND illustration. The official
// skin_table gives a few skins two of them — `illustId` and the 「sp」 差分立绘 `spIllustId` (克洛丝 星月漂流记,
// 凯尔希 时遗, 阿米娅 于万千宇宙之中, 新约能天使 寻翼之歌) — and the library index lists the sp page under its own
// derived id `<skinId>_sp`. Emitting that as a skin is what made the picker draw two identical-looking 「寻翼之歌」
// tiles, one of them disabled with 「这张外观的模型不在本机客户端里」: it is not a skin, it has no model, and the
// picker's enlarged preview is where it belongs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalogue, SP_ILLUSTR_SUFFIX } from '../tools/skin-library/build-catalogue.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));

/** A library index holding one skin, its sp illustration, and a portrait-only skin. */
const LIBRARY = {
  tiers: {
    illust: {
      'char_x_a#1': { path: '/assets/local/library/opillust/char_x_a%231/illust.png', w: 1024, h: 1024, charId: 'char_x', skinId: 'char_x@a#1' },
      'char_x_a#1_sp': { path: '/assets/local/library/opillust/char_x_a%231_sp/illust.png', w: 1024, h: 1024, charId: 'char_x', skinId: 'char_x@a#1_sp' },
      'char_y_b#2_sp': { path: '/assets/local/library/opillust/char_y_b%232_sp/illust.png', w: 1024, h: 1024, charId: 'char_y', skinId: 'char_y@b#2_sp' },
    },
    portrait: {
      'char_x_c#3': { path: '/assets/local/library/opportrait/char_x_c%233/image.png', w: 180, h: 360, charId: 'char_x', skinId: 'char_x@c#3' },
    },
    avatar: {},
  },
};
const TABLE = {
  charSkins: {
    'char_x@a#1': { displaySkin: { skinName: '甲', skinGroupName: '系列/I' } },
    'char_x@c#3': { displaySkin: { skinName: '丙', skinGroupName: '系列/III' } },
  },
};

describe('skin catalogue: a second illustration is not a second skin', () => {
  test('the sp page is folded into its skin as `spIllust`, not emitted as a row', () => {
    const { doc, namesMissing } = buildCatalogue(LIBRARY, TABLE, ['char_x']);
    assert.deepEqual(doc.chars.char_x.map((s) => s.id), ['char_x@a#1', 'char_x@c#3']);
    assert.equal(doc.chars.char_x[0].spIllust, true, 'the sp illustration is flagged on the skin it belongs to');
    assert.equal(doc.chars.char_x[0].name, '甲');
    assert.equal(doc.chars.char_x[0].group, '系列/I');
    assert.equal(doc.chars.char_x[1].spIllust, undefined, 'a skin with one illustration carries no flag');
    assert.deepEqual(namesMissing, [], 'the sp row would otherwise have been the one without a name');
    assert.equal(doc.counts.skins, 2);
  });

  test('an sp page whose skin the catalogue does not hold keeps a row of its own', () => {
    // never drop art just because its base entry is missing (a partial library index, an operator out of scope)
    const { doc } = buildCatalogue(LIBRARY, TABLE, ['char_y']);
    assert.deepEqual(doc.chars.char_y.map((s) => s.id), [`char_y@b#2${SP_ILLUSTR_SUFFIX}`]);
  });

  test('an operator outside the project\'s roster is not catalogued at all', () => {
    const { doc } = buildCatalogue(LIBRARY, TABLE, ['char_nobody']);
    assert.deepEqual(Object.keys(doc.chars), []);
  });
});

describe('skin catalogue: the committed data/skins.json', () => {
  const cat = readJSON('data/skins.json');
  const ids = Object.values(cat.chars).flat().map((s) => s.id);

  test('no skin id ends in the sp suffix', () => {
    assert.deepEqual(ids.filter((id) => id.endsWith(SP_ILLUSTR_SUFFIX)), []);
    assert.equal(cat.counts.skins, ids.length, 'the count is the number of rows');
  });

  test('the skins the official table gives two illustrations to are flagged, once each', () => {
    for (const [charId, id, name] of [
      ['char_1041_angel2', 'char_1041_angel2@iteration#6', '寻翼之歌'],
      ['char_003_kalts', 'char_003_kalts@sale#14', '时遗'],
    ]) {
      const rows = cat.chars[charId].filter((s) => s.name === name);
      assert.deepEqual(rows.map((s) => s.id), [id], `${name} is one skin`);
      assert.equal(rows[0].spIllust, true, `${name} carries its second illustration`);
    }
  });

  test('the library index holds the sp page the flag points at', () => {
    const lib = readJSON('tools/skin-library/library-index.json');
    const sp = lib.tiers.illust['char_1041_angel2_iteration#6_sp'];
    assert.equal(sp.skinId, `char_1041_angel2@iteration#6${SP_ILLUSTR_SUFFIX}`);
    assert.match(sp.path, /opillust\/char_1041_angel2_iteration%236_sp\/illust\.png$/);
  });
});
