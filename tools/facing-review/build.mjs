// 皮肤朝向审核工具 — 单个文件。渲染客户端提取出来的两个模型，让人对照官方立绘判断正反面。
//
//   node build.mjs                       # 默认读同目录下的 Stronghold-Protocol，每页 8 个
//   node build.mjs --project <目录>       # 指定项目目录
//   node build.mjs --limit 12 --port 3400
//
// 打开 http://127.0.0.1:3400/ 。判定会存到 <脚本目录>/facing-review/verdicts.json，刷新页面会回填，
// 所以可以分任意多次做完。填满一页会自动保存并翻页。导出在 facing-review/report.txt。
//
// 这个文件可以放在仓库里的 tools/facing-review/（默认指向仓库根目录），也可以放在仓库外面
// （默认指向同级的 Stronghold-Protocol/）；两种情况都可以用 --project 覆盖。
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

// 项目目录的推断：脚本若在仓库里（tools/facing-review/），仓库根就是它的上两级；否则当成放在仓库外面，
// 默认取同级目录下的 Stronghold-Protocol/。两种都可用 --project 覆盖。
function defaultProject() {
  const inRepo = path.join(HERE, '..', '..', 'data', 'local-assets.json');
  if (existsSync(inRepo)) return path.join(HERE, '..', '..');
  const beside = path.join(HERE, 'Stronghold-Protocol');
  if (existsSync(path.join(beside, 'data', 'local-assets.json'))) return beside;
  return path.join(HERE, '..', '..');
}

const PROJECT = path.resolve(arg('project', defaultProject()));
const PUB = path.join(PROJECT, 'public');
const LIMIT = Math.max(1, Number(arg('limit', 8)) || 8);
const PORT = Number(arg('port', 3400)) || 3400;
const OUT = path.join(HERE, 'facing-review');
const VERDICTS = path.join(OUT, 'verdicts.json');
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- 读项目数据
const need = {
  'data/local-assets.json': path.join(PROJECT, 'data', 'local-assets.json'),
  'data/skins-local.json': path.join(PROJECT, 'data', 'skins-local.json'),
  'data/skins.json': path.join(PROJECT, 'data', 'skins.json'),
  'public/vendor/pixi.min.js': path.join(PUB, 'vendor', 'pixi.min.js'),
  'public/vendor/pixi-spine.js': path.join(PUB, 'vendor', 'pixi-spine.js'),
};
for (const [label, abs] of Object.entries(need)) {
  if (!existsSync(abs)) {
    console.error(`缺少 ${label}\n  找的是: ${abs}\n  用 --project <项目目录> 指定正确的位置。`);
    process.exit(2);
  }
}
const manifest = JSON.parse(readFileSync(need['data/local-assets.json'], 'utf8'));
const skinsLocal = JSON.parse(readFileSync(need['data/skins-local.json'], 'utf8'));
const catalogue = JSON.parse(readFileSync(need['data/skins.json'], 'utf8'));

const nameOf = (charId, skinId) => {
  const hit = (catalogue.chars?.[charId] || []).find((s) => s.id === skinId);
  return hit?.name || skinId;
};

/** 一个 model group 里的 .skel 条目（含磁盘字节数与骨骼声明边界）。 */
function skelOf(group) {
  const g = manifest.groups?.[group];
  if (!g) return null;
  for (const [name, e] of Object.entries(g)) {
    if (!name.endsWith('.skel')) continue;
    const rel = decodeURIComponent(String(e.path || '')).replace(/^\/+/, '');
    const abs = path.join(PUB, rel);
    return { url: e.path, bytes: existsSync(abs) ? statSync(abs).size : 0 };
  }
  return null;
}

// 每个有本地模型的皮肤一条
const all = [];
for (const [charId, c] of Object.entries(skinsLocal.chars)) {
  for (const [skinId, e] of Object.entries(c.skins || {})) {
    // 条目的 `group` 是皮肤系列名（如「斗争血脉/IV」），模型根路径在 spine.front.group 里
    const root = String(e.spine?.front?.group || '').replace(/\/(front|back)$/, '');
    if (!root) continue;
    const front = skelOf(`${root}/front`);
    if (!front) continue;
    const back = skelOf(`${root}/back`);
    all.push({
      charId, skinId, name: nameOf(charId, skinId), stem: root.split('/').pop(),
      front, back,
      frontBounds: e.spine?.front?.bounds || null,
      backBounds: e.spine?.back?.bounds || null,
      illust: e.illust || manifest.groups?.[root]?.['illust.png']?.path || null,
    });
  }
}
all.sort((a, b) => (a.charId + a.skinId).localeCompare(b.charId + b.skinId));

const readVerdicts = () => {
  if (!existsSync(VERDICTS)) return {};
  try { return JSON.parse(readFileSync(VERDICTS, 'utf8')); } catch { return {}; }
};
const tallyOf = (v) => {
  const t = {};
  for (const e of Object.values(v)) t[e.verdict] = (t[e.verdict] || 0) + 1;
  return t;
};

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const kb = (n) => (n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');

// ---------------------------------------------------------------- 页面
// 一个 filter + 一个页码 = 一页。`todo` 只列还没判定的，`flip` / `bad` / `ok` 回看已判的。
function pageList(filter) {
  const v = readVerdicts();
  if (filter === 'todo') return all.filter((e) => !v[e.skinId]?.verdict);
  if (filter === 'all') return all;
  return all.filter((e) => v[e.skinId]?.verdict === filter);
}

function html(filter, page) {
  const list = pageList(filter);
  const pages = Math.max(1, Math.ceil(list.length / LIMIT));
  const p = Math.min(Math.max(0, page), pages - 1);
  const slice = list.slice(p * LIMIT, p * LIMIT + LIMIT);
  const total = Object.keys(readVerdicts()).length;

  const cards = slice.map((e) => {
    const fb = e.frontBounds, bb = e.backBounds;
    // 骨骼声明的边界：正反面差得多的时候，统一缩放会让两边看起来不一样大（那不是渲染错）
    const ratio = fb && bb && bb.width ? fb.width / bb.width : null;
    const warn = ratio && (ratio > 1.35 || ratio < 1 / 1.35)
      ? `<span class="warn" title="骨骼声明的绘制边界在正反面之间差得多，统一缩放会让两边不一样大——不是渲染错误">骨骼边界 ${Math.round(fb.width)}×${Math.round(fb.height)} / ${Math.round(bb.width)}×${Math.round(bb.height)}</span>`
      : '';
    return `<div class="card" data-skin="${esc(e.skinId)}">
  <div class="head"><b>${esc(e.name)}</b><code>${esc(e.charId)}</code><code>${esc(e.skinId)}</code>${warn}</div>
  <div class="body">
    <div class="ill">${e.illust ? `<img loading="lazy" src="${esc(e.illust)}" alt="">` : '<span class="none">无立绘</span>'}</div>
    <div class="models">
      <div class="m"><div class="cap"><span class="tag">front/</span><span>${kb(e.front.bytes)}</span></div><canvas data-skel="${esc(e.front.url)}"></canvas></div>
      <div class="m"><div class="cap"><span class="tag">back/</span><span>${e.back ? kb(e.back.bytes) : '无'}</span></div>${e.back ? `<canvas data-skel="${esc(e.back.url)}"></canvas>` : '<span class="none">客户端没有背面模型</span>'}</div>
    </div>
  </div>
  <div class="verdict">
    <span class="lbl">front/ 里是正面吗？</span>
    <button data-v="ok">正确<kbd>1</kbd></button>
    <button data-v="flip">相反<kbd>2</kbd></button>
    <button data-v="bad">完全错误<kbd>3</kbd></button>
    <span class="done"></span>
  </div>
</div>`;
  }).join('\n');

  const nav = (label, f, pg) => `<a class="${f === filter && pg === p ? 'cur' : ''}" href="/?f=${f}&p=${pg}">${label}</a>`;
  const links = [];
  for (let i = 0; i < pages; i++) {
    if (pages > 12 && i > 2 && i < pages - 3 && Math.abs(i - p) > 1) { if (links[links.length - 1] !== '…') links.push('…'); continue; }
    links.push(nav(String(i + 1), filter, i));
  }

  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>皮肤朝向审核</title><style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#14171a;color:#e8eaed;font:13px/1.55 system-ui,"Segoe UI","Microsoft YaHei",sans-serif}
header{position:sticky;top:0;z-index:9;background:#1b2126;border-bottom:1px solid #2c343b;padding:9px 14px}
.row1{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
h1{font-size:14.5px;margin:0;font-weight:600}
.hint{color:#98a2ac;font-size:12px}
.row2{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:7px}
.row2 .links{display:flex;gap:5px;flex-wrap:wrap;max-width:60%}
.row2 .links a{color:#8ea3b8;text-decoration:none;padding:1px 5px;border-radius:4px;font-size:12px}
.row2 .links a:hover{background:#262e35}
.row2 .links a.cur{background:#2f3a44;color:#fff;font-weight:600}
button{font:inherit;background:#2a3138;color:#e8eaed;border:1px solid #3a444d;border-radius:6px;padding:4px 10px;cursor:pointer}
button:hover{background:#333d45}
button kbd{margin-left:6px;font-size:10px;color:#8b959f;border:1px solid #465059;border-radius:3px;padding:0 3px}
button.on[data-v=ok]{background:#1f6f43;border-color:#2e9c5f}
button.on[data-v=flip]{background:#8a6a12;border-color:#c39a1c}
button.on[data-v=bad]{background:#7d2a2a;border-color:#b83c3c}
#memo{color:#c9a227;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(600px,1fr));gap:13px;padding:13px}
.card{background:#1a1f24;border:1px solid #2b333a;border-radius:10px;padding:9px 11px 11px}
.card.cur{outline:1px solid #3d6b8f}
.head{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin-bottom:7px}
.head b{font-size:13.5px}
.head code{color:#8ea3b8;font-size:11.5px}
.head .warn{color:#c9a227;font-size:11px;border:1px solid #6b5a1c;border-radius:4px;padding:0 5px}
.body{display:grid;grid-template-columns:150px 1fr;gap:11px}
.ill{background:#0e1113;border:1px solid #262e35;border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center;min-height:150px}
.ill img{width:100%;display:block}
.models{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.m{background:#0e1113;border:1px solid #262e35;border-radius:8px;overflow:hidden;display:flex;flex-direction:column}
.m .cap{display:flex;justify-content:space-between;padding:4px 8px;font-size:11.5px;color:#98a2ac;border-bottom:1px solid #212830}
.m .cap .tag{font-weight:600;color:#c3ccd5}
.m canvas{display:block;width:100%;height:250px}
.none{color:#6b7681;font-size:12px;padding:10px}
.verdict{display:flex;gap:8px;align-items:center;margin-top:9px}
.verdict .lbl{color:#98a2ac;font-size:12px;margin-right:3px}
.done{color:#63c98a;font-size:12px}
.empty{padding:40px;text-align:center;color:#8ea3b8}
.zw{display:inline-block;width:1em}
</style></head><body>
<header>
  <div class="row1">
    <h1>皮肤朝向审核</h1>
    <span class="hint">左＝<b>官方立绘</b>（它画的就是该朝的方向）<span class="zw"></span>右＝客户端提取的两个模型，分别在 <code>front/</code> 与 <code>back/</code><br>
      判断：<b>front/</b> 里那个模型，是不是这个干员的<b>正面</b>（面向观众）？</span>
    <span style="margin-left:auto;display:flex;gap:8px;align-items:center">
      <label class="hint" style="display:flex;gap:5px;align-items:center;cursor:pointer"><input type="checkbox" id="autoNext" checked>填完自动翻页</label>
      <button id="allOk" title="本页其余未判定的都记为「正确」">本页余下＝正确</button>
      <span class="hint">已判定 <b id="cnt">0</b>/${slice.length} · 累计 ${total}/${all.length}</span>
      <button id="save">保存本页</button>
      <button id="export">导出全部</button>
      <span id="memo"></span>
    </span>
  </div>
  <div class="row2">
    <span class="hint">筛选</span>
    <span class="links">
      <a class="${filter === 'todo' ? 'cur' : ''}" href="/?f=todo&p=0">未判定 ${all.length - total}</a>
      <a class="${filter === 'all' ? 'cur' : ''}" href="/?f=all&p=0">全部 ${all.length}</a>
      <a class="${filter === 'flip' ? 'cur' : ''}" href="/?f=flip&p=0">相反</a>
      <a class="${filter === 'bad' ? 'cur' : ''}" href="/?f=bad&p=0">完全错误</a>
      <a class="${filter === 'ok' ? 'cur' : ''}" href="/?f=ok&p=0">正确</a>
    </span>
    <span class="hint">页</span>
    <span class="links" id="pages">${links.join('')}</span>
  </div>
</header>
<div class="grid" id="grid">${cards || '<div class="empty">这个筛选下没有皮肤。</div>'}</div>
<script src="/vendor/pixi.min.js"></script>
<script src="/vendor/pixi-spine.js"></script>
<script>
const FILTER = ${JSON.stringify(filter)}, PAGE = ${p}, PAGES = ${pages};
const verdicts = {};
const cards = [...document.querySelectorAll('.card')];

// 一个模型画成固定尺寸的静帧：按骨骼声明的边界缩放，所有皮肤之间可比
async function draw(cv) {
  const skel = cv.dataset.skel;
  try {
    const res = await PIXI.Assets.load(skel);
    const data = res && (res.spineData || res);
    const sp = new PIXI.spine.Spine(data);
    const names = (data.animations || []).map((a) => a.name);
    const clip = names.find((n) => /^idle$/i.test(n)) || names.find((n) => /idle/i.test(n)) || names[0];
    if (clip) sp.state.setAnimation(0, clip, true);
    sp.update(0);
    let r = sp.spineData && sp.spineData.bounds;
    if (!r || !(r.width > 0) || !(r.height > 0)) { const b = sp.getLocalBounds(); r = { x: b.x, y: b.y, width: b.width, height: b.height }; }
    const W = 300, H = 250;
    const sc = Math.min(W / Math.max(1, r.width), H / Math.max(1, r.height)) * 0.92;
    sp.scale.set(sc);
    sp.position.set(W / 2 - (r.x + r.width / 2) * sc, H / 2 - (r.y + r.height / 2) * sc);
    const app = new PIXI.Application({ view: cv, width: W, height: H, background: 0x0e1113, antialias: true, autoStart: false, resolution: 1 });
    app.stage.addChild(sp);
    app.renderer.render(app.stage);
    cv.dataset.ok = '1';
  } catch (e) {
    cv.width = 300; cv.height = 250;
    const g = cv.getContext('2d');
    g.fillStyle = '#7d2a2a'; g.font = '12px sans-serif';
    g.fillText('加载失败 ' + String(e.message || e).slice(0, 34), 8, 20);
    cv.dataset.ok = '0';
  }
}

function paintCount() {
  document.getElementById('cnt').textContent = Object.keys(verdicts).filter((i) => verdicts[i]).length;
}
function mark(i, v) {
  verdicts[i] = v;
  const c = cards[i];
  if (c) {
    for (const b of c.querySelectorAll('button[data-v]')) b.classList.toggle('on', b.dataset.v === v);
    const d = c.querySelector('.done'); if (d) d.textContent = '已记录';
  }
  maybeAdvance();
}
function fillCount() { return cards.filter((_, i) => verdicts[i]).length; }

let timer = null, moving = false, restoring = false;
function maybeAdvance() {
  const memo = document.getElementById('memo');
  const auto = document.getElementById('autoNext');
  if (restoring || !auto || !auto.checked || moving) return;
  if (fillCount() < cards.length) return;
  if (PAGE >= PAGES - 1) { memo.textContent = '本页填完（最后一页）—— 点「导出全部」'; return; }
  let left = 3;
  memo.textContent = '本页填完，' + left + ' 秒后保存并翻页…（Shift+1/2/3 可撤回）';
  clearInterval(timer);
  timer = setInterval(async () => {
    if (--left > 0) { memo.textContent = '本页填完，' + left + ' 秒后保存并翻页…'; return; }
    clearInterval(timer);
    moving = true;
    await save();
    location.href = nextHref();
  }, 1000);
}
function cancelAdvance() { if (timer) { clearInterval(timer); timer = null; const m = document.getElementById('memo'); if (m) m.textContent = '已取消自动翻页'; } }
function nextHref() { return '/?f=' + FILTER + '&p=' + Math.min(PAGES - 1, PAGE + 1); }

function payload() {
  return cards.map((c, i) => (verdicts[i] ? { skinId: c.dataset.skin, verdict: verdicts[i] } : null)).filter(Boolean);
}
async function save() {
  const memo = document.getElementById('memo');
  const body = payload();
  if (!body.length) { memo.textContent = '本页还没有判定'; return; }
  try {
    const r = await fetch('/verdicts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entries: body }) });
    const j = await r.json();
    memo.textContent = '已保存 ' + body.length + ' 条（累计 ' + j.saved + '）' + (j.tally ? ' ' + JSON.stringify(j.tally) : '');
  } catch (e) { memo.textContent = '保存失败: ' + String(e.message || e); }
}

for (const c of cards) for (const cv of c.querySelectorAll('canvas')) draw(cv);

document.getElementById('grid').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-v]');
  if (!b) return;
  const i = cards.indexOf(b.closest('.card'));
  if (i < 0) return;
  if (verdicts[i] && verdicts[i] !== b.dataset.v) cancelAdvance();
  mark(i, b.dataset.v);
  paintCount();
});
document.getElementById('allOk').addEventListener('click', () => {
  cards.forEach((_, i) => { if (!verdicts[i]) mark(i, 'ok'); });
  paintCount();
});
document.getElementById('save').addEventListener('click', () => save());
document.getElementById('export').addEventListener('click', async () => { await save(); window.open('/report.txt', '_blank'); });

window.addEventListener('keydown', (ev) => {
  if (ev.target.matches('input, textarea')) return;
  const KEY = { 1: 'ok', 2: 'flip', 3: 'bad' };
  if (KEY[ev.key]) {
    const top = cards.filter((c) => c.getBoundingClientRect().top > -40);
    const target = (ev.shiftKey ? top : top.filter((c) => !verdicts[cards.indexOf(c)]))[0];
    if (!target) return;
    const i = cards.indexOf(target);
    if (ev.shiftKey || verdicts[i]) cancelAdvance();
    mark(i, KEY[ev.key]);
    paintCount();
    cards[i + 1]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    ev.preventDefault();
  } else if (ev.key === 'Enter') { save(); ev.preventDefault(); }
  else if (ev.key === 'n' || ev.key === 'N') { location.href = nextHref(); }
});

// 回填已保存的判定（回填期间不触发自动翻页，否则一打开满员页面就立刻跳走）
restoring = true;
fetch('/verdicts.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})).then((allv) => {
  let n = 0;
  cards.forEach((c, i) => { const v = allv[c.dataset.skin]; if (v && v.verdict) { mark(i, v.verdict); n++; } });
  restoring = false;
  paintCount();
  document.getElementById('memo').textContent = n
    ? '已回填 ' + n + ' 条（共 ' + Object.keys(allv).length + ' 条已保存）'
    : (Object.keys(allv).length ? '本页无已保存判定（共 ' + Object.keys(allv).length + ' 条）' : '');
}).catch(() => { restoring = false; });
</script></body></html>`;
}

// ---------------------------------------------------------------- 服务
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.skel': 'application/octet-stream', '.atlas': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };

const send = (res, status, body, type = 'text/plain; charset=utf-8', extra = {}) => {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  res.writeHead(status, { 'content-type': type, 'content-length': buf.length, ...extra });
  res.end(buf);
};

createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'POST' && url === '/verdicts') {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const prev = readVerdicts();
      let j = {};
      try { j = JSON.parse(body || '{}'); } catch { /* 坏 body 不写盘 */ }
      let added = 0;
      for (const e of j.entries || []) {
        if (!e || !e.skinId || !['ok', 'flip', 'bad'].includes(e.verdict)) continue;
        const meta = all.find((x) => x.skinId === e.skinId);
        if (!meta) continue;
        prev[e.skinId] = {
          charId: meta.charId, skinId: meta.skinId, name: meta.name, stem: meta.stem,
          frontBytes: meta.front.bytes, backBytes: meta.back ? meta.back.bytes : null,
          verdict: e.verdict, at: new Date().toISOString(),
        };
        added++;
      }
      writeFileSync(VERDICTS, JSON.stringify(prev, null, 1));
      const tally = tallyOf(prev);
      console.log(`[verdicts] +${added} → ${Object.keys(prev).length} 条  ${JSON.stringify(tally)}`);
      send(res, 200, JSON.stringify({ saved: Object.keys(prev).length, added, tally }), MIME['.json']);
    });
    return;
  }

  if (url === '/verdicts.json') {
    return send(res, 200, JSON.stringify(readVerdicts(), null, 1), MIME['.json'],
      { 'content-disposition': 'attachment; filename="facing-verdicts.json"' });
  }

  if (url === '/report.txt' || url === '/report.json') {
    const v = readVerdicts();
    const rows = Object.values(v).sort((a, b) => (a.charId + a.skinId).localeCompare(b.charId + b.skinId));
    const tally = tallyOf(v);
    if (url === '/report.json') {
      return send(res, 200, JSON.stringify({ total: all.length, judged: rows.length, tally, entries: rows }, null, 1), MIME['.json'],
        { 'content-disposition': 'attachment; filename="facing-report.json"' });
    }
    const lines = [
      `# 皮肤朝向审核  ${rows.length}/${all.length} 条已判定`,
      `# 汇总  ${JSON.stringify(tally)}`,
      '',
      ...rows.map((e) => [e.verdict.padEnd(5), e.skinId.padEnd(40), e.name].join('  ')),
      '',
      '# 还没判定的：',
      ...all.filter((e) => !v[e.skinId]?.verdict).map((e) => '       ' + e.skinId.padEnd(40) + '  ' + e.name),
    ];
    return send(res, 200, lines.join('\n') + '\n', 'text/plain; charset=utf-8',
      { 'content-disposition': 'attachment; filename="facing-report.txt"' });
  }

  if (url === '/' || url === '/index.html') {
    const q = new URL(req.url, 'http://x').searchParams;
    const f = ['todo', 'all', 'ok', 'flip', 'bad'].includes(q.get('f')) ? q.get('f') : 'todo';
    return send(res, 200, html(f, Math.max(0, Number(q.get('p')) || 0)), MIME['.html']);
  }

  if (url === '/favicon.ico') return send(res, 204, '');

  // /assets /fonts 走项目 public，其余（/vendor）也走项目 public —— 工具不需要自己的静态目录
  const rel = decodeURIComponent(url).replace(/^\/+/, '');
  const abs = path.resolve(PUB, rel);
  if (!abs.startsWith(PUB) || !existsSync(abs) || !statSync(abs).isFile()) return send(res, 404, 'not found: ' + url);
  res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream', 'content-length': statSync(abs).size });
  createReadStream(abs).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`皮肤朝向审核  http://127.0.0.1:${PORT}/`);
  console.log(`  项目      ${PROJECT}`);
  console.log(`  皮肤      ${all.length} 个有本地模型（${all.filter((e) => e.back).length} 个有背面）`);
  console.log(`  已判定    ${Object.keys(readVerdicts()).length} 条`);
  console.log(`  结果      ${VERDICTS}`);
  console.log('  Ctrl+C 停止。');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    const v = readVerdicts();
    const tally = tallyOf(v);
    console.log(`\n已判定 ${Object.keys(v).length}/${all.length}  ${JSON.stringify(tally)}`);
    const flip = Object.values(v).filter((e) => e.verdict === 'flip').map((e) => e.skinId);
    if (flip.length) console.log('front/ 装的是背面：\n  ' + flip.join('\n  '));
    console.log('结果目录: ' + OUT);
    process.exit(0);
  });
}
