// 皮肤 picker (docs/SKINS.md, public/js/ui/skinPicker.js + ui/skins.js): the rows of one operator, and the enlarged
// preview of a skin the official table gives TWO illustrations to (`spIllustId`, e.g. 新约能天使 寻翼之歌 / 凯尔希 时遗).
//
// Both halves of that feature are pinned here, because either one alone brings the duplicate back: the catalogue must
// not list `<skinId>_sp` as a skin (test/skin-catalogue.test.js), and the picker must not append it from the library
// index as a library-only row.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The client reads /data/<name>.json; the library index is served from data/ too but committed under tools/ (it is
// machine-local in data/, git-ignored), so the stub maps it to the committed copy.
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  const file = name === 'library-index.json' ? 'tools/skin-library/library-index.json' : path.join('data', name);
  try {
    const body = readFileSync(path.join(ROOT, file), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { data } = await import('../../public/js/data.js');
const { availableSkins, chosenSkin, libraryImage, SP_ILLUSTR_SUFFIX } = await import('../../public/js/ui/skins.js');
const { SkinPreview } = await import('../../public/js/ui/skinPicker.js');

await data.loadAll('skins', 'library');

const ANGEL = 'char_1041_angel2';
const KALTS = 'char_003_kalts';

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const imgs = (v) => [...walk(v)].filter((n) => n.type === 'img').map((n) => n.props.src);
const hasClass = (v, c) => [...walk(v)].some((n) => typeof n.props?.class === 'string' && n.props.class.split(/\s+/).includes(c));

describe('皮肤 picker: one row per skin', () => {
  test('a skin with two illustrations is ONE row, carrying the second illustration', () => {
    const list = availableSkins(ANGEL);
    assert.deepEqual(list.map((x) => x.id), ['char_1041_angel2@iteration#6'], 'no _sp row');
    assert.equal(list[0].name, '寻翼之歌');
    assert.equal(list[0].spIllust, libraryImage(ANGEL, `char_1041_angel2@iteration#6${SP_ILLUSTR_SUFFIX}`, 'illust'));
    assert.match(list[0].spIllust, /opillust\/char_1041_angel2_iteration%236_sp\/illust\.png$/);
  });

  test('the library-only escape hatch still appends skins the catalogue does not list, but never an sp page', () => {
    // 凯尔希's sp page is in the library index; the catalogue lists her two skins, so the list is exactly those two
    const list = availableSkins(KALTS);
    assert.deepEqual(list.map((x) => x.id), ['char_003_kalts@boc#6', 'char_003_kalts@sale#14']);
    assert.deepEqual(list.filter((x) => x.id.endsWith(SP_ILLUSTR_SUFFIX)), []);
    const sale = list.find((x) => x.id === 'char_003_kalts@sale#14');
    assert.equal(sale.spIllust, libraryImage(KALTS, `char_003_kalts@sale#14${SP_ILLUSTR_SUFFIX}`, 'illust'));
    assert.equal(list.find((x) => x.id === 'char_003_kalts@boc#6').spIllust, null, 'her other skin has one illustration');
  });

  test('a skin without a second illustration answers null', () => {
    for (const x of availableSkins('char_103_angel')) assert.equal(x.spIllust, null);
  });
});

describe('皮肤 picker: the enlarged preview', () => {
  const FIRST = '/assets/local/library/opillust/char_1041_angel2_iteration%236/illust.png';
  const SECOND = '/assets/local/library/opillust/char_1041_angel2_iteration%236_sp/illust.png';

  test('a two-illustration skin shows both, side by side', () => {
    const v = SkinPreview({ art: FIRST, second: SECOND });
    assert.deepEqual(imgs(v), [FIRST, SECOND]);
    assert.ok(hasClass(v, 'lo-skin-preview--dual'));
  });

  test('one illustration keeps the single-image preview', () => {
    const v = SkinPreview({ art: FIRST, second: null });
    assert.deepEqual(imgs(v), [FIRST]);
    assert.ok(!hasClass(v, 'lo-skin-preview--dual'));
  });

  test('the second illustration alone is still shown (a skin whose page the web manifest lacks)', () => {
    const v = SkinPreview({ art: null, second: SECOND });
    assert.deepEqual(imgs(v), [SECOND]);
    assert.ok(hasClass(v, 'lo-skin-preview--dual'));
  });

  test('no art at all renders nothing', () => {
    assert.equal(SkinPreview({ art: null, second: null }), null);
  });
});

// 自选编队 reuses one slot's chess id for whichever operator is picked into it (screens/diy.js passes `slot.slotId`),
// so the stored entry can name the PREVIOUS operator's skin. That used to leave the whole section unselected — 默认
// included, because the 默认 tile reads `chosen ? 'false' : 'true'` — instead of falling back to 默认.
describe('皮肤 picker: a slot whose operator changed', () => {
  const SLOT = 'chess_char_5_diy1_a';

  test('a skin of another operator is not a choice: the section shows 默认', () => {
    assert.equal(chosenSkin(ANGEL, SLOT, { [SLOT]: 'char_003_kalts@sale#14' }), null);
    assert.equal(chosenSkin(KALTS, SLOT, { [SLOT]: 'char_1041_angel2@iteration#6' }), null);
    // the same entry IS a choice for the operator it belongs to, so switching back brings the skin back
    assert.equal(chosenSkin(KALTS, SLOT, { [SLOT]: 'char_003_kalts@sale#14' }), 'char_003_kalts@sale#14');
  });

  test('an id the catalogue no longer holds (or never held) is not a choice either', () => {
    assert.equal(chosenSkin(ANGEL, SLOT, { [SLOT]: 'char_1041_angel2@iteration#6_sp' }), null);
    assert.equal(chosenSkin(ANGEL, SLOT, { [SLOT]: 'char_1041_angel2@gone#9' }), null);
  });

  test('one of this operator\'s skins is a choice, and no entry at all is 默认', () => {
    assert.equal(chosenSkin(ANGEL, SLOT, { [SLOT]: 'char_1041_angel2@iteration#6' }), 'char_1041_angel2@iteration#6');
    assert.equal(chosenSkin(ANGEL, SLOT, {}), null);
    assert.equal(chosenSkin(ANGEL, SLOT, { [SLOT]: '' }), null);
  });
});
