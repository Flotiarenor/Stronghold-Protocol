// tools/local-extract/extract.py (DESIGN §13 / §15): the job table, the manifest merge of --only, and the helpers that
// summarise Materials (map/<theme>/materials.json) and GameObjects (mesh/<bundle>/prefab.json) for the official 3D
// board, the token Spine models (TOKEN_SPINES: the Front renderer of each battle token prefab, the merged pages), and
// enemy_scales.py's table of the official enemy model sizes (build-data MODEL_SCALES). The Python helpers run without
// UnityPy (duck-typed fakes; merge_alpha needs Pillow); the real-output checks skip when nothing was extracted on this
// machine. The token models' manifest side: test/local-token-models.test.js.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(ROOT, 'tools/local-extract');
const PY = ['python3', 'python'].find((bin) => spawnSync(bin, ['--version']).status === 0);
const ENV = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
const manifest = (() => { try { return JSON.parse(readFileSync(path.join(ROOT, 'data/local-assets.json'), 'utf8')); } catch { return null; } })();

/** Run python code with `extract` imported as `e`; returns the parsed JSON it prints. */
function py(code) {
  const src = `import sys, json\nfrom types import SimpleNamespace as NS\nsys.path.insert(0, ${JSON.stringify(TOOL)})\nimport extract as e\n${code}`;
  const r = spawnSync(PY, ['-c', src], { encoding: 'utf8', env: ENV });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

describe('extract.py helpers (no UnityPy needed)', { skip: !PY && 'no python3' }, () => {
  test('job table: map themes export Materials, the board meshes are exported with their prefab', () => {
    const r = spawnSync(PY, [path.join(TOOL, 'extract.py'), '--print-jobs'], { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0, r.stderr);
    const { jobs } = JSON.parse(r.stdout);
    for (const sub of ['map/autochess', 'map/autochesssand']) assert.deepEqual(jobs.find((j) => j.sub === sub).kinds, ['Material', 'Texture2D'], sub);
    const mesh = jobs.filter((j) => j.sub.startsWith('mesh/'));
    assert.deepEqual(mesh.map((j) => j.bundle), [
      'arts/maps/map_autochess/bkg_mesh.ab', 'arts/maps/common/meshes/s_background_common.ab',
      'arts/maps/common/meshes/s_common_box_01.ab', 'arts/maps/common/meshes/s_wind_device.ab',
    ]);
    for (const j of mesh) assert.deepEqual(j.kinds, ['GameObject', 'Material', 'Mesh', 'Texture2D']);
    assert.equal(new Set(jobs.map((j) => j.sub)).size, jobs.length, 'one output dir per job');
  });

  test('job table: the token Spine models (TOKEN_SPINES) come from the battle token packs into spine/token/<id>; no plain job writes under spine/', () => {
    const r = spawnSync(PY, [path.join(TOOL, 'extract.py'), '--print-jobs'], { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0, r.stderr);
    const { jobs, tokenSpines, enemySpines } = JSON.parse(r.stdout);
    assert.equal(tokenSpines.bundles, 'pkgrps/btl_pfb_tokens_*.ab');
    assert.equal(tokenSpines.sub, 'spine/token');
    assert.equal(enemySpines.sub, 'spine/enemy');
    // every listed id is a token of the game data without a web model (data/assets.json tokens[id].spine), sorted, unique
    const ids = tokenSpines.ids;
    assert.equal(ids.length, 40);
    assert.deepEqual([...ids].sort(), ids);
    assert.equal(new Set(ids).size, ids.length);
    const tokens = JSON.parse(readFileSync(path.join(ROOT, 'data/tokens.json'), 'utf8'));
    const backups = JSON.parse(readFileSync(path.join(ROOT, 'data/backups.json'), 'utf8'));
    const web = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8')).tokens;
    for (const id of ids) {
      assert.ok(tokens[id] || backups.tokens[id], `${id}: a token of the game data`);
      if (id === 'token_10031_swire2_gdtrap') assert.ok(web[id]?.spine, 'champagne has a web skin fallback');
      else assert.equal(web[id]?.spine, undefined, `${id}: no web model`);
    }
    // the 自选 summons whose prefab draws nothing (an EmptyAnimator: displayType HIDDEN / an effect) are left out
    for (const id of ['token_10039_ulpia_block', 'token_10055_phatm2_mndclv', 'token_10058_sbell2_icetgt', 'token_10065_demetr_dmtpos',
      'token_10071_aglna2_agairp']) assert.ok(!ids.includes(id), id);
    assert.ok(!jobs.some((j) => j.sub.startsWith('spine/')), 'the old skinpack job of 乌尔比安\'s block extracted nothing (its skin prefab holds no art)');
  });

  test('token helpers: prefab container ids, --only selection of model ids, the Front renderer, atlas page names', () => {
    const out = py(`
W = {'token_10009_weedy_cannon', 'token_10002_kalts_mon3tr'}
ids = ['token_a', 'token_b']
nodes = [('Back', True, {'m_PathID': 2}), ('Front', True, {'m_PathID': 1}), ('Down', True, {'m_PathID': 3})]
print(json.dumps({
  'ids': [e.token_prefab_id(c, W) for c in ['dyn/battle/prefabs/[uc]tokens/token_10009_weedy_cannon.prefab',
    'battle/prefabs/tokens/token_10002_kalts_mon3tr.prefab',
    'dyn/battle/prefabs/skins/character/token_10002_kalts_mon3tr/token_10002_kalts_mon3tr_boc#6.prefab',
    'dyn/battle/prefabs/[uc]tokens/token_10000_silent_healrb.prefab', None]],
  'only': [e.spine_ids(o, 'spine/token', ids) for o in ([], ['spine'], ['spine/token'], ['spine/token/token_b'], ['spine/enemy'], ['map'])],
  'pick': [e.pick_spine_node(nodes)[0], e.pick_spine_node([('Spine', True, {}), ('X', True, {})])[0],
           e.pick_spine_node([('Front', False, {}), ('Other', True, {})])[0], e.pick_spine_node([('A', False, {})])[0], e.pick_spine_node([])],
  'pages': e.atlas_pages('\\ntoken_x.png\\nsize: 64,64\\nformat: RGBA8888\\nC_Body\\n  rotate: false\\n  xy: 2, 2\\n\\ntoken_x2.png\\nsize: 32,32\\nC_Leg\\n  xy: 0, 0\\n'),
}))`);
    assert.deepEqual(out.ids, ['token_10009_weedy_cannon', 'token_10002_kalts_mon3tr', null, null, null]);
    assert.deepEqual(out.only, [['token_a', 'token_b'], ['token_a', 'token_b'], ['token_a', 'token_b'], ['token_b'], [], []]);
    assert.deepEqual(out.pick, ['Front', 'Spine', 'Other', 'A', null]);
    assert.deepEqual(out.pages, ['token_x.png', 'token_x2.png']);
  });

  test('url_safe_atlas: a page named after the client (`…_epoque#7.png`) is renamed to the model stem in the text AND the map', () => {
    // The `#` cannot be percent-encoded here: pixi-spine reads the page name out of the .atlas text and resolves it
    // against the atlas URL itself, and PIXI's loader strips everything from a `#` on before it picks a parser — the
    // URL left has no `.png`, no image parser matches it and `load()` resolves null, so the whole model fails. The file
    // on disk and the page line have to carry the same safe name (the stem the .skel/.atlas of the model already use).
    const out = py(`
pages = {'char_102_texas_epoque#7.png': 'IMG', 'plain.png': 'IMG2'}
raw = '\\r\\nchar_102_texas_epoque#7.png\\r\\nsize: 512,512\\r\\npma: true\\r\\nC_Body\\r\\n  rotate: false\\r\\n  xy: 0, 0\\r\\n\\r\\nplain.png\\r\\nsize: 8,8\\r\\n'
text, mapped = e.url_safe_atlas(raw, pages)
print(json.dumps({'names': e.atlas_pages(text), 'keys': sorted(mapped),
  'lines': e.normalize_atlas(text, {p: (1, 2) for p in e.atlas_pages(text)}).split('\\n'),
  'unsafe': [e.page_filename(n) for n in ['a?b%c#d.png', 'plain.png']]}))`);
    assert.deepEqual(out.names, ['char_102_texas_epoque_7.png', 'plain.png'], 'the page line is the URL-safe name');
    assert.deepEqual(out.keys, ['char_102_texas_epoque_7.png', 'plain.png'], 'and the map key follows it, so text and file agree');
    assert.deepEqual(out.lines, ['', 'char_102_texas_epoque_7.png', 'size: 1,2', 'pma: true', 'C_Body', '  rotate: false',
      '  xy: 0, 0', '', 'plain.png', 'size: 1,2', 'pma: true', ''], 'the sizes/pma normalization still runs on the new names');
    assert.deepEqual(out.unsafe, ['a_b_c_d.png', 'plain.png'], '`?` (a query) and `%` (an escape) break a page URL the same way');
  });

  test('asset_url: the client names are percent-encoded as one whole path (the `#` of a skin included)', () => {
    // The one generator behind every manifest path. The escape has to live here: boardArt.js and the avatar /
    // portrait / skin URLs of assets.js hand the manifest string to the browser unchanged, so a `#` that survived
    // into the manifest would be cut at the fragment and 404. render/board3d/load.js is the one consumer that
    // escapes, and it decodes first (`manifestUrl`) so it is a no-op for what this writes — see
    // test/render/board3d-extract.test.js for the contract over the whole manifest.
    const out = py(`
print(json.dumps({
  'skin':  e.asset_url('library', 'opavatar', 'char_002_amiya_epoque#4', 'image.png'),
  'query': e.asset_url('map', 'fx', 'a?b.png'),
  'gate':  e.asset_url('map', 'fx', '[opt]merged_textures.webp'),
  'plus':  e.asset_url('library', 'opavatar', 'char_002_amiya_1+', 'image.png')}))`);
    assert.equal(out.skin, '/assets/local/library/opavatar/char_002_amiya_epoque%234/image.png', '`#` is escaped');
    assert.equal(out.query, '/assets/local/map/fx/a%3Fb.png', '`?` is escaped');
    assert.equal(out.gate, '/assets/local/map/fx/%5Bopt%5Dmerged_textures.webp', 'brackets are escaped');
    assert.equal(out.plus, '/assets/local/library/opavatar/char_002_amiya_1%2B/image.png', '`+` is escaped');
  });

  test('prefab_spine_nodes: the SkeletonAnimation renderers of a prefab tree, depth first, inactive branches marked', () => {
    // a directional token prefab: Graphic / DefaultSkin / FaceSwitcher / {Front, Back} (each with its own skeleton), an
    // inactive Spare renderer, a component in another bundle (m_FileID ≠ 0) and a MonoBehaviour without a type tree
    const out = py(`
class O:
    def __init__(self, kind, tree=None, err=False): self.type, self._t, self._e = NS(name=kind), tree, err
    def read_typetree(self):
        if self._e: raise ValueError('no type tree')
        return self._t
objs = {}
def go(pid, name, kids=(), sda=None, active=1):
    tr = 100 + pid
    comps = [{'component': {'m_FileID': 0, 'm_PathID': tr}}]
    objs[tr] = O('Transform', {'m_Children': [{'m_FileID': 0, 'm_PathID': 100 + k} for k in kids], 'm_GameObject': {'m_FileID': 0, 'm_PathID': pid}})
    if sda is not None:
        objs[200 + pid] = O('MonoBehaviour', {'skeletonDataAsset': {'m_FileID': 0, 'm_PathID': sda}})
        comps.append({'component': {'m_FileID': 0, 'm_PathID': 200 + pid}})
    objs[pid] = O('GameObject', {'m_Name': name, 'm_IsActive': active, 'm_Component': comps})
go(1, 'token_x', kids=(2, 7))
go(2, 'Graphic', kids=(3,))
go(3, 'FaceSwitcher', kids=(4, 5, 6))
go(4, 'Front', sda=41)
go(5, 'Back', sda=51)
go(6, 'Spare', sda=61, active=0)
go(7, 'Modes')
objs[107]._t['m_Children'] = []
objs[1]._t['m_Component'] += [{'component': {'m_FileID': 3, 'm_PathID': 999}}, {'component': {'m_FileID': 0, 'm_PathID': 300}}]
objs[300] = O('MonoBehaviour', err=True)
nodes = e.prefab_spine_nodes(objs[1].read_typetree(), objs)
print(json.dumps({'nodes': [[n, a, r['m_PathID']] for n, a, r in nodes], 'pick': e.pick_spine_node(nodes)[2]['m_PathID']}))`);
    assert.deepEqual(out.nodes, [['Front', true, 41], ['Back', true, 51], ['Spare', false, 61]]);
    assert.equal(out.pick, 41, 'the Front skeleton (the fetched tokens use Front / Spine too)');
  });

  test('merge_alpha: the [alpha] texture as A, else the page\'s own alpha; RGB clamped to A (premultiplied input), multiplied for straight input', { skip: spawnSync(PY, ['-c', 'import PIL']).status !== 0 && 'no Pillow' }, () => {
    const out = py(`
from PIL import Image
rgb = Image.new('RGB', (2, 1)); rgb.putdata([(200, 100, 50), (90, 90, 90)])
alpha = Image.new('RGB', (2, 1)); alpha.putdata([(128, 128, 128), (255, 255, 255)])
rgba = Image.new('RGBA', (2, 1)); rgba.putdata([(60, 200, 10, 100), (0, 0, 0, 0)])
print(json.dumps({'split': list(e.merge_alpha(rgb, alpha).getdata()), 'own': list(e.merge_alpha(rgba, None).getdata()),
  'opaque': list(e.merge_alpha(rgb, None).getdata()), 'straight': list(e.merge_alpha(rgba, None, True).getdata())}))`);
    assert.deepEqual(out.split, [[128, 100, 50, 128], [90, 90, 90, 255]], 'A from the [alpha] texture, RGB ≤ A');
    assert.deepEqual(out.own, [[60, 100, 10, 100], [0, 0, 0, 0]], 'an RGBA page keeps its alpha (the newer tokens: _UseAlphaTex 0)');
    assert.deepEqual(out.opaque, [[200, 100, 50, 255], [90, 90, 90, 255]], 'no alpha anywhere: opaque');
    assert.deepEqual(out.straight, [[23, 78, 3, 100], [0, 0, 0, 0]], '_StraightAlphaInput 1: RGB × A / 255 (Pillow truncates)');
  });

  test('material_info: textures by name with tiling, floats, colours, sorted keywords; unresolvable refs → null', () => {
    const out = py(`
class P:
    def __init__(self, obj=None, pid=1, err=False): self.m_PathID, self._o, self._e = pid, obj, err
    def read(self):
        if self._e: raise FileNotFoundError('cab-x not found')
        return self._o
tex = lambda n: NS(m_Name=n)
v2 = lambda x, y: NS(x=x, y=y)
mat = NS(m_Name='MT', m_Shader=P(err=True), m_ValidKeywords=['_NORMALMAP', 'HG_LIGHTMAP'],
  m_SavedProperties=NS(
    m_TexEnvs=[('_MainTex', NS(m_Texture=P(tex('TX_D')), m_Scale=v2(2, 1), m_Offset=v2(0, -0.0))),
               ('_BumpMap', NS(m_Texture=P(pid=0), m_Scale=v2(1, 1), m_Offset=v2(0, 0))),
               ('_EmissionMap', NS(m_Texture=P(err=True), m_Scale=v2(1, 1), m_Offset=v2(0, 0)))],
    m_Floats=[('_Cutoff', 0.40799999237060547), ('_Bad', float('nan'))],
    m_Colors=[('_EmissionColor', NS(r=0.559, g=0.559, b=0.559, a=1))]))
bg = NS(m_Name='BG', m_Shader=P(NS(m_ParsedForm=NS(m_Name='Torappu/Unlit/Texture'))), m_ShaderKeywords='B A',
  m_SavedProperties=NS(m_TexEnvs=[], m_Floats=[], m_Colors=[]))
print(json.dumps([e.material_info(mat), e.material_info(bg)]))`);
    assert.deepEqual(out[0], {
      shader: null, keywords: ['HG_LIGHTMAP', '_NORMALMAP'],
      textures: { _MainTex: { texture: 'TX_D', scale: [2, 1], offset: [0, 0] } },
      floats: { _Bad: 0, _Cutoff: 0.408 }, colors: { _EmissionColor: [0.559, 0.559, 0.559, 1] },
    });
    assert.deepEqual(out[1], { shader: 'Torappu/Unlit/Texture', keywords: ['A', 'B'], textures: {}, floats: {}, colors: {} });
  });

  test('dep_bundles: the shader bundles load beside jobs that export Materials only', () => {
    const out = py(`
import tempfile, pathlib
d = pathlib.Path(tempfile.mkdtemp())
(d / 'shaders').mkdir()
for n in ('standarddirectional.ab', 'other.ab', 'notes.txt'): (d / 'shaders' / n).write_bytes(b'')
(d / 'shaders' / 'sub.ab').mkdir()
rel = lambda ps: [p.relative_to(d).as_posix() for p in ps]
print(json.dumps({'mat': rel(e.dep_bundles(d, {'Texture2D', 'Material'})), 'sprite': rel(e.dep_bundles(d, {'Sprite'})),
                  'none': rel(e.dep_bundles(d / 'missing', {'Material'}))}))`);
    assert.deepEqual(out, { mat: ['shaders/other.ab', 'shaders/standarddirectional.ab'], sprite: [], none: [] });
  });

  test('prefab_node: local transform, parent, mesh and materials; no -0.0 in the output', () => {
    const out = py(`
class P:
    def __init__(self, obj=None, pid=1, err=False): self.m_PathID, self._o, self._e = pid, obj, err
    def read(self):
        if self._e: raise FileNotFoundError('external')
        return self._o
class Transform:
    def __init__(self, **k): self.__dict__.update(k)
class MeshFilter:
    def __init__(self, **k): self.__dict__.update(k)
class MeshRenderer:
    def __init__(self, **k): self.__dict__.update(k)
v3 = lambda x, y, z: NS(x=x, y=y, z=z)
root_go = NS(m_Name='Root')
root_tr = Transform(m_LocalPosition=v3(0, 0, 0), m_LocalRotation=NS(x=0, y=0, z=0, w=1), m_LocalScale=v3(1, 1, 1),
                    m_Father=P(pid=0), m_GameObject=P(root_go))
child_tr = Transform(m_LocalPosition=v3(-0.0, 3.5254242420196533, -8), m_LocalRotation=NS(x=0, y=-0.0, z=0, w=1),
                     m_LocalScale=v3(0.01, 0.01, 0.01), m_Father=P(root_tr), m_GameObject=None)
go = NS(m_Name='S_Background_shadow', m_Component=[
  NS(component=P(child_tr)),
  NS(component=P(MeshFilter(m_Mesh=P(NS(m_Name='S_Background_shadow'))))),
  NS(component=P(MeshRenderer(m_Materials=[P(NS(m_Name='lambert1')), P(err=True)]))),
  NS(component=P(err=True)),
])
print(json.dumps(e.prefab_node(go)))`);
    assert.deepEqual(out, {
      name: 'S_Background_shadow', parent: 'Root', pos: [0, 3.525424, -8], rot: [0, 0, 0, 1], scale: [0.01, 0.01, 0.01],
      mesh: 'S_Background_shadow', materials: ['lambert1', null],
    });
    const raw = spawnSync(PY, ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(TOOL)}); import extract as e, json; print(json.dumps(e.vec(type('V', (), {'x': -0.0, 'y': float('inf'), 'z': 1e-9})())))`], { encoding: 'utf8', env: ENV });
    assert.equal(raw.stdout.trim(), '[0.0, 0, 0.0]');
  });

  test('guide pages (host bandwidth layer 0): --webp writes a WebP copy of every page PNG (lossy q90 by default, lossless on request), the manifest lists it, the PNG stays',
    { skip: spawnSync(PY, ['-c', "import sys; from PIL import features; sys.exit(0 if features.check('webp') else 1)"], { env: ENV }).status !== 0 && 'no Pillow with WebP' }, () => {
      const jobs = JSON.parse(spawnSync(PY, [path.join(TOOL, 'extract.py'), '--print-jobs'], { encoding: 'utf8', env: ENV }).stdout);
      assert.deepEqual(jobs.guideWebp.sub, 'guide');
      assert.equal(jobs.guideWebp.mode, 'lossy', 'quality 90, the maintainer\'s choice of 2026-10-12');
      assert.ok(!jobs.webp.some((w) => w.sub === 'guide'), 'the board texture table is unchanged');
      const out = py(`
import tempfile, pathlib
from PIL import Image
root = pathlib.Path(tempfile.mkdtemp())
sub = root / 'guide'
sub.mkdir()
for i, name in enumerate(['autochess_home_1', 'autochess_shop_2']):
    img = Image.new('RGBA', (48, 32), (10, 20, 30, 255))
    for x in range(48):
        for y in range(32): img.putpixel((x, y), ((x * 5 + i * 40) % 256, (y * 7) % 256, (x * y) % 256, 255 if x % 7 else 254))
    img.save(sub / f'{name}.png')
groups = {'guide': {n: {'path': f'/assets/local/guide/{n}.png', 'w': 48, 'h': 32, 'kind': 'Sprite'} for n in ['autochess_home_1', 'autochess_shop_2']},
          'ui/battle': {'x': {'path': '/assets/local/ui/battle/x.png', 'w': 2, 'h': 2, 'kind': 'Sprite'}}}
groups['guide']['autochess_handbook_9'] = {'path': '/assets/local/guide/autochess_handbook_9.png', 'kind': 'Sprite'}  # no PNG on disk
mf = root / 'local-assets.json'
mf.write_text(json.dumps({'version': 1, 'source': 'local-client', 'count': 4, 'groups': groups}))
code = e.webp_only(root, mf, lambda *a: None)
doc = json.loads(mf.read_text())
g = doc['groups']['guide']
modes = {k: v.get('webp') for k, v in g.items()}
px = lambda p: list(Image.open(p).convert('RGBA').getdata())
e.GUIDE_WEBP_MODE = 'lossless'
again = e.run_webp(root, 'guide', doc['groups'], lambda *a: None)
print(json.dumps({'code': code, 'paths': {k: v['path'] for k, v in g.items()}, 'modes': modes,
                  'relisted': {k: v.get('webp') for k, v in g.items()},
                  'other': doc['groups']['ui/battle']['x']['path'],
                  'same': all(px(sub / f'{n}.png') == px(sub / f'{n}.webp') for n in ['autochess_home_1', 'autochess_shop_2']),
                  'png': all((sub / f'{n}.png').exists() for n in ['autochess_home_1', 'autochess_shop_2']),
                  'again': again}))`);
      assert.equal(out.code, 0);
      const at = (n, ext) => `/assets/local/guide/${n}.${ext}`;
      assert.deepEqual(out.paths, { autochess_home_1: at('autochess_home_1', 'webp'), autochess_shop_2: at('autochess_shop_2', 'webp'), autochess_handbook_9: at('autochess_handbook_9', 'png') });
      assert.deepEqual(out.modes, { autochess_home_1: 'lossy', autochess_shop_2: 'lossy', autochess_handbook_9: null });
      assert.equal(out.other, '/assets/local/ui/battle/x.png', 'other groups keep their PNGs');
      assert.ok(out.png, 'the PNG stays beside the copy');
      assert.equal(out.again, 2, 'a second run (another GUIDE_WEBP_MODE) rewrites the copies the manifest already lists');
      assert.deepEqual(out.relisted, { autochess_home_1: 'lossless', autochess_shop_2: 'lossless', autochess_handbook_9: null });
      assert.ok(out.same, 'lossless: the same pixels, alpha included');
    });
});

describe('extracted board-scene files (when a local client was extracted)', { skip: !manifest && 'no data/local-assets.json' }, () => {
  const onDisk = (p) => path.join(ROOT, 'public', p);
  const hasFiles = existsSync(path.join(ROOT, 'public/assets/local/mesh'));

  test('map/autochess materials.json: the official material parameters, textures present in the group', { skip: !manifest?.groups?.['map/autochess']?.materials && 'not extracted' }, () => {
    const g = manifest.groups['map/autochess'];
    assert.equal(g.materials.kind, 'Materials');
    if (!hasFiles) return;
    const mats = JSON.parse(readFileSync(onDisk(g.materials.path), 'utf8'));
    assert.deepEqual(Object.keys(mats), ['MT_autochess', 'MT_autochess_Transparent', 'MT_autochess_common', 'MT_autochessi_BG']);
    assert.equal(mats.MT_autochess.textures._MainTex.texture, 'TX_autochessi_D');
    assert.equal(mats.MT_autochess.textures._BumpMap.texture, 'TX_autochessi_N');
    assert.ok(mats.MT_autochess.keywords.includes('_EMISSION'));
    assert.equal(mats.MT_autochessi_BG.shader, 'Torappu/Unlit/Texture');
    // external shader references resolve through the shaders/*.ab bundles (they were all null before)
    for (const k of ['MT_autochess', 'MT_autochess_Transparent', 'MT_autochess_common']) assert.equal(mats[k].shader, 'Torappu/Scene/StandardDirectional', k);
    const sand = JSON.parse(readFileSync(onDisk(manifest.groups['map/autochesssand'].materials.path), 'utf8'));
    for (const [k, m] of Object.entries(sand)) assert.match(m.shader || '', /^Torappu\/Scene\/(StandardRealtimeShadow|StylizedWater)$/, k);
    for (const m of Object.values(mats)) for (const t of Object.values(m.textures)) assert.ok(g[t.texture], `${t.texture} extracted`);
  });

  test('mesh/*: OBJ files with their vertex counts and a prefab.json each', { skip: !Object.keys(manifest?.groups || {}).some((k) => k.startsWith('mesh/')) && 'not extracted' }, () => {
    const groups = Object.entries(manifest.groups).filter(([k]) => k.startsWith('mesh/'));
    assert.deepEqual(groups.map(([k]) => k).sort(), ['mesh/map_autochess_bkg', 'mesh/s_background_common', 'mesh/s_common_box_01', 'mesh/s_wind_device']);
    for (const [name, g] of groups) {
      assert.equal(g.prefab?.kind, 'Prefab', name);
      const meshes = Object.values(g).filter((x) => x.kind === 'Mesh');
      assert.ok(meshes.length >= 1, name);
      if (!hasFiles) continue;
      const prefab = JSON.parse(readFileSync(onDisk(g.prefab.path), 'utf8'));
      assert.equal(prefab.length, g.prefab.count);
      for (const node of prefab) {
        assert.equal(node.pos.length, 3);
        assert.equal(node.rot.length, 4);
        if (node.mesh) assert.ok(g[node.mesh], `${name}: prefab mesh ${node.mesh} exported`);
      }
      for (const m of meshes) {
        const obj = readFileSync(onDisk(m.path), 'utf8');
        const v = obj.split('\n').filter((l) => l.startsWith('v ')).length;
        assert.equal(v, m.verts, m.path);
        assert.ok(obj.split('\n').some((l) => l.startsWith('f ')), `${m.path} has faces`);
      }
    }
    const bkg = JSON.parse(readFileSync(onDisk(manifest.groups['mesh/map_autochess_bkg'].prefab.path), 'utf8'));
    assert.deepEqual(bkg.map((n) => n.name), ['S_Background_common', 'S_Background_shadow']);
  });
});

describe('extracted operator-skin models (when a local client was extracted)', { skip: !manifest?.groups?.['spine/op/char_003_kalts/char_003_kalts_boc_6/front'] && 'no local skin models extracted' }, () => {
  const groups = Object.entries(manifest.groups).filter(([g]) => g.startsWith('spine/op/'));
  const onDisk = (p) => path.join(ROOT, 'public', p);

  test('no page or model file is named with the client\'s `#` (a page name reaches the loader unencoded)', () => {
    assert.ok(groups.length > 100, `every installed skin: ${groups.length} groups`);
    for (const [g, files] of groups) {
      for (const name of Object.keys(files)) assert.ok(!name.includes('#') && !name.includes('%23'), `${g}/${name}`);
    }
  });

  test('every atlas names a page of its own group — the file pixi-spine will request', () => {
    let checked = 0;
    for (const [g, files] of groups) {
      const atlas = Object.keys(files).find((n) => n.endsWith('.atlas'));
      if (!atlas) continue;
      const p = onDisk(files[atlas].path);
      if (!existsSync(p)) continue;
      // the page lines of a Spine atlas: an unindented line without ':' after a blank line (or first) — the same rule
      // as extract.py _is_page_line
      const lines = readFileSync(p, 'utf8').replace(/\r\n/g, '\n').split('\n');
      const page = lines.find((l, i) => { const t = l.trim(); return t && !t.includes(':') && !/^\s/.test(l) && (i === 0 || !lines[i - 1].trim()); });
      assert.ok(page, `${g}: an atlas with a page`);
      assert.ok(Object.hasOwn(files, page), `${g}: ${page} is listed in the manifest group`);
      checked++;
    }
    assert.ok(checked > 100, `atlases checked: ${checked}`);
  });

  // facings_of + local-skins-meta.mjs fixFacings: one Front per skin and a Back only as a second skeleton.
  //
  // History, so this is not "fixed" back: the first version took refs[0] (bundle order — a coin flip), the second
  // took the LARGEST skeleton (for some skins that is the `build_` display model or the dynamic illustration, so
  // 希望巡游 rendered the base chibi instead of the battle one). The facing is now decided by the client's own `Die`
  // clip, which the Front alone carries: 264 of 268 pairs have it on exactly one side, and it corrected 4 pairs the
  // size rule had backwards. 3 pairs carry `Die` on both sides and 1 on neither; those keep the size-based order.
  test('one Front per skin; a Back only as a second model, never without its Front', () => {
    const metaPath = path.join(ROOT, 'tools/assets/local-skins-meta.json');
    if (!existsSync(metaPath)) return;
    const models = JSON.parse(readFileSync(metaPath, 'utf8')).models || {};
    const keys = Object.keys(models);
    const fronts = keys.filter((k) => !k.endsWith('/back'));
    const backOwners = new Set(keys.filter((k) => k.endsWith('/back')).map((k) => k.replace(/\/back$/, '')));
    assert.ok(fronts.length > 100, `fronts: ${fronts.length}`);
    assert.strictEqual(new Set(fronts).size, fronts.length, 'no skin has two Fronts');
    for (const owner of backOwners) assert.ok(fronts.includes(owner), `a Back without its Front: ${owner}`);

    // a battle Back is the Front's clip set minus the fall; a SECOND skeleton that is the base (dorm) chibi instead
    // is a different model. The client ships that for exactly two skins — their `back` holds the base chibi's
    // Default / Interact / Move / Relax / Sit / Sleep / Special instead of a battle Back, and nothing in the clips
    // distinguishes it from a battle skeleton, so they are the two documented exceptions rather than a silent pass.
    const BASE_ONLY = ['Interact', 'Sit', 'Sleep', 'Relax'];
    const exceptions = [];
    let withDie = 0;
    for (const owner of backOwners) {
      const f = Object.keys(models[owner].animations || {});
      const b = Object.keys(models[`${owner}/back`].animations || {});
      if (f.includes('Die')) withDie++;
      if (b.some((c) => BASE_ONLY.includes(c))) { exceptions.push(owner); continue; }
      if (b.includes('Die') && !f.includes('Die')) assert.fail(`${owner}: the Back carries Die and the Front does not`);
    }
    assert.ok(withDie > 200, `Fronts carrying Die: ${withDie}`);
    assert.deepStrictEqual(exceptions,
      ['char_134_ifrit/char_134_ifrit_kfc_1', 'char_253_greyy/char_253_greyy_epoque_8'],
      'the skins whose second skeleton is the base chibi (a new one means the same model is being mis-assigned)');
  });
});

describe('enemy_scales.py (official enemy model sizes → build-data MODEL_SCALES, user playtest #6 item 9)', { skip: !PY && 'no python3' }, () => {
  test('group_table: prefabs off the 0.27 standard, grouped by value, "enemy_" dropped; build-data carries the same values', () => {
    const src = `import sys, json\nsys.path.insert(0, ${JSON.stringify(TOOL)})\nimport enemy_scales as s\n`
      + `print(json.dumps(s.group_table({'enemy_1005_yokai_3': 0.16, 'enemy_1005_yokai': 0.2, 'enemy_1040_bombd': 0.2, 'enemy_10083_hlbird': 0.27, 'enemy_x': None})))`;
    const r = spawnSync(PY, ['-c', src], { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0, r.stderr);
    const lines = JSON.parse(r.stdout);
    assert.deepEqual(lines, ["  [0.16, ['1005_yokai_3']],", "  [0.2, ['1005_yokai', '1040_bombd']],"]);
    const bd = readFileSync(path.join(ROOT, 'tools/build-data.mjs'), 'utf8');
    assert.ok(bd.includes(lines[0].trim()), 'build-data MODEL_SCALES: 威龙 0.16');
  });
});
