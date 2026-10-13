// 干员皮肤：客户端状态与同步 (docs/SKINS.md).
//
// Two different things live here, and keeping them apart is what makes 「按需安装」 work:
//
//   * the CATALOGUE (data/skins.json) — every skin the project knows about, installed or not: ids, names, series.
//     It carries no URLs, because a skin that is not installed has no files to point at.
//   * what is INSTALLED (data/assets.json → chars[charId].skins) — the skins whose models are actually on this
//     server. `availableSkins()` marks which is which, and the picker greys out (or offers to install) the rest.
//
// The choice itself is a plain `{ [chessId]: skinId }` map, persisted per browser in localStorage and mirrored to
// the server through `room.skins` — the same shape and the same wiring as the operator loadout (ui/loadoutSync.js),
// except that this one is PUBLIC: the server puts it in `Match.publicView().players[]`, which is how a teammate
// sees your skin.

import { createStore, loadPref, savePref } from '../store.js';
import { data } from '../data.js';

export const SKINS_PREF = 'skins';
export const SYNC_DEBOUNCE_MS = 500;
export const RETRY_MS = 1500;
/**
 * The library index's id for a skin's SECOND official illustration.
 *
 * The official skin table gives a few skins two of them (`illustId` and the 「sp」 差分立绘 `spIllustId`), and the
 * extractor's `illust` tier lists the sp page under `<skinId>_sp`. It is not a skin of its own: `availableSkins` folds
 * it into the skin it belongs to (`spIllust`, the picker's enlarged preview) instead of offering a duplicate tile
 * (docs/SKINS.md; tools/skin-library/build-catalogue.mjs uses the same suffix).
 */
export const SP_ILLUSTR_SUFFIX = '_sp';

function readStored() {
  const raw = loadPref(SKINS_PREF, null);
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [chessId, skinId] of Object.entries(raw)) {
      if (typeof chessId === 'string' && typeof skinId === 'string' && skinId) out[chessId] = skinId;
    }
  }
  return out;
}

/**
 * The chosen skins (per browser), the sync state, and the skin currently being installed — kept apart from the
 * app store for the same reason the loadout is.
 */
export const skinsStore = createStore({ entries: readStored(), sync: 'idle', installing: null, installingProgress: null });

/**
 * Ask the server to install a skin's files (docs/SKINS.md).
 *
 * The reply is only an acknowledgement — an install takes tens of seconds, far longer than the 8 s a request is
 * allowed (net.js REQUEST_TIMEOUT_MS) — so the outcome arrives as `skins.changed`, which installSkinsSync()
 * handles here because it is the one place that owns the socket.
 * @param {any} net
 * @param {string} skinId
 * @returns {Promise<{ ok: boolean, state?: string }>}
 */
export async function requestSkinInstall(net, skinId) {
  skinsStore.set({ installing: skinId, installingProgress: { skinId, phase: 'queued', done: 0, total: 0 } });
  try {
    // A resolved request() already means the server accepted it. The framework answers with a bare
    // `{ t: 'ok', rid }` (server/net.js) and carries NO payload, so there is nothing here to inspect: checking
    // `.ok` on the reply (which the first version did) read undefined, treated every accepted request as a
    // failure and cleared `installing` at once — the panel fell back to its normal header and the progress the
    // server was sending all along had nothing left to render into. Errors arrive as a rejection.
    await net.request('room.skin.install', { skinId });
    return { ok: true };
  } catch (e) {
    skinsStore.set({ installing: null, installingProgress: null });
    throw e;
  }
}

/** Replace the whole selection (persisted at once; the sync picks the change up). */
export function setSkins(entries) {
  const next = {};
  for (const [chessId, skinId] of Object.entries(entries && typeof entries === 'object' ? entries : {})) {
    if (typeof skinId === 'string' && skinId) next[chessId] = skinId;
  }
  savePref(SKINS_PREF, next);
  skinsStore.set({ entries: next });
}

/** Choose a skin for one operator. */
export function setSkin(chessId, skinId) {
  setSkins({ ...skinsStore.get().entries, [chessId]: skinId });
}

/** Drop one operator's choice (it goes back to its default model). */
export function clearSkin(chessId) {
  const next = { ...skinsStore.get().entries };
  delete next[chessId];
  setSkins(next);
}

/** The skin this browser picked for an operator, or null. */
export const skinFor = (chessId) => skinsStore.get().entries[chessId] || null;

/**
 * The operator's library entries, gathered from the three tiers into one object per skin id.
 *
 * data/library-index.json is keyed by the CLIENT's asset id per tier, not by operator, because that is how the client
 * packs it (spritepack/ui_char_avatar_<N>.ab and friends). This is the one place that reshapes it into
 * `{ [skinId]: { illust?, portrait?, avatar? } }`, with the operator's own default appearance under `charId` — the key
 * a picker asking for `<charId>_1` / `<charId>_2` needs.
 * @param {string} charId
 * @returns {Record<string, {illust?: string, portrait?: string, avatar?: string}>}
 */
function libraryOf(charId) {
  const tiers = data.get('library')?.tiers;
  if (!tiers) return {};
  const out = {};
  const put = (skinId, kind, path) => { if (skinId) (out[skinId] ||= {})[kind] = path; };
  for (const e of Object.values(tiers.illust || {})) {
    if (e?.charId === charId && e.path) put(e.skinId || charId, 'illust', e.path);
  }
  for (const [assetId, e] of Object.entries(tiers.portrait || {})) {
    if (e?.charId !== charId || !e.path) continue;
    // `<charId>_1` (E0/E1) and `_2` (E2) are the operator's own default appearance, not a skin
    put(assetId === `${charId}_1` || assetId === `${charId}_2` ? charId : (e.skinId || assetId), 'portrait', e.path);
  }
  for (const [assetId, e] of Object.entries(tiers.avatar || {})) {
    if (e?.charId !== charId || !e.path) continue;
    put(assetId === charId || assetId === `${charId}_2` ? charId : (e.skinId || assetId), 'avatar', e.path);
  }
  return out;
}

/** The URL of one library image of a skin (or of the operator's default appearance, under `charId`). */
export function libraryImage(charId, skinId, kind) {
  return libraryOf(charId)[skinId]?.[kind] || null;
}

/**
 * Every skin of an operator, whether or not this install has it.
 *
 * Takes the OPERATOR id (`char_498_inside`), not the chess id (`chess_char_1_01_a`): both data/skins.json and
 * data/assets.json are grouped per operator, while a skin *choice* is stored per chess — see ui/skinPicker.js.
 *
 * The catalogue is generated from the client library, so a skin it lists normally has a model too; a skin the library
 * knows only as an IMAGE is appended as a reference, not as a choice.
 *
 * `source` says where the MODEL comes from, which is what makes a skin selectable: 'local' (extracted from the
 * installed game client, data/skins-local.json — the authoritative source, tools/local-extract/extract.py), 'web'
 * (downloaded from the mirror, data/assets.json) or null (no model on this server, so the renderer would fall back to
 * the operator's own chibi — an image alone is not enough, and `libraryOnly` marks those). A local copy wins when
 * several have it: it is the client's own bytes, and the only source that cannot vanish with an upstream repository.
 * @param {string} charId
 * @returns {{ id: string, name: string, group: string, installed: boolean, source: 'local'|'web'|null, libraryOnly: boolean,
 *   spIllust: string|null }[]} `spIllust` is the skin's second official illustration where the client ships one, else null
 */
export function availableSkins(charId) {
  const list = data.get('skins')?.chars?.[charId];
  const lib = libraryOf(charId);
  const localHere = data.get('skinsLocal')?.chars?.[charId]?.skins || {};
  const webHere = data.get('assets')?.chars?.[charId]?.skins || {};
  // An operator whose skins the CATALOGUE does not list can still have library images. Those are appended so the
  // appearance is visible, but only a skin with a MODEL is offered as a choice (see `source` above).
  //
  // `<skinId>_sp` is NOT one of them: it is the same skin's SECOND official illustration (`spIllustId` — 凯尔希 时遗,
  // 新约能天使 寻翼之歌, docs/SKINS.md), which the library index lists under its own derived id. Appending it would
  // draw a tile that looks like a duplicate of a skin that is already there, so it is folded into that skin below.
  const known = new Set((Array.isArray(list) ? list : []).map((s) => s.id));
  const extra = Object.keys(lib).filter((id) => id !== charId && !known.has(id) && !id.endsWith(SP_ILLUSTR_SUFFIX)).sort();
  const rows = [
    ...(Array.isArray(list) ? list : []),
    ...extra.map((id) => ({ id, name: id.split('@')[1] || id, group: '' })),
  ];
  return rows.map((s) => {
    const model = localHere[s.id] ? 'local' : (webHere[s.id] ? 'web' : null);
    // an image in the library is not a model: choosing such a skin would leave the renderer on the operator's chibi
    const libraryOnly = model === null && !!lib[s.id];
    // The second illustration of a skin the official table gives two of (the catalogue's `spIllust` flag): the picker's
    // enlarged preview shows it beside the first. null for every other skin, and for one whose sp page is not here.
    const spIllust = s.spIllust ? (lib[`${s.id}${SP_ILLUSTR_SUFFIX}`]?.illust || null) : null;
    return { id: s.id, name: s.name, group: s.group || '', installed: model !== null, source: model, libraryOnly, spIllust };
  });
}

/**
 * The skin this operator really has chosen for `chessId`, or null (默认).
 *
 * The store is keyed by CHESS id, and 自选编队 reuses a slot's chess id when its operator is changed (`screens/diy.js`
 * hands the picker the slot's own chess id): the entry then names a skin of the operator that was there BEFORE, which
 * no tile of the current one matches. Rendering it as the choice leaves every tile unselected — 默认 included — so a
 * stored id that is not in `availableSkins(charId)` counts as no choice at all, the same fallback the renderer and the
 * server make for a mismatched skin (`assets.js spineEntry`, `PlayerBasics.setSkins`). The stored entry is left alone:
 * switching the slot back to the previous operator brings its skin back.
 * @param {string} charId the operator the panel shows
 * @param {string} chessId the chess the choice is stored under
 * @param {Record<string, string>} [entries] defaults to the live store
 * @returns {string|null}
 */
export function chosenSkin(charId, chessId, entries = skinsStore.get().entries) {
  const id = (entries && entries[chessId]) || null;
  if (!id) return null;
  return availableSkins(charId).some((x) => x.id === id) ? id : null;
}

/** Where a skin's MODEL comes from on this server ('local' | 'web' | null). @param {string} charId */
export function skinSource(charId, skinId) {
  if (data.get('skinsLocal')?.chars?.[charId]?.skins?.[skinId]) return 'local';
  if (data.get('assets')?.chars?.[charId]?.skins?.[skinId]) return 'web';
  return null;
}

/** Whether this install has the files for a skin (locally extracted or downloaded). @param {string} charId */
export function isInstalled(charId, skinId) {
  return skinSource(charId, skinId) !== null;
}

/** Load what the picker needs (the catalogue, and the manifests that say what is installed). */
export function loadSkinData() {
  data.load('skins').catch(() => {});
  data.load('assets').catch(() => {});
  // the local client's extracted models (optional: absent on a server without one)
  data.load('skinsLocal').catch(() => {});
  // the operator image library of the same extraction: three tiers covering every operator the client ships
  data.load('library').catch(() => {});
}

/**
 * Keep the server's copy of this browser's skins current.
 *
 * Mirrors installLoadoutSync, minus the sanitising: the loadout has to be checked against data/chess.json before
 * it is sent (a stale entry would be dropped by the server), whereas a skinId needs no lookup to be sent — the
 * server keeps the entries whose chess it recognises and drops the rest, and an unknown skinId is harmless.
 * @param {{ net: any, timers?: { setTimeout: Function, clearTimeout: Function } }} deps
 * @returns {{ flush: () => Promise<void>, dispose: () => void }}
 */
export function installSkinsSync({ net, timers } = {}) {
  const T = timers || { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
  let timer = null;
  let seq = 0;
  let pendingJson = null;
  let lastSent = null;
  let disposed = false;

  const setState = (sync) => { if (skinsStore.get().sync !== sync) skinsStore.set({ sync }); };
  const schedule = (ms = SYNC_DEBOUNCE_MS) => {
    if (disposed) return;
    T.clearTimeout(timer);
    setState('pending');
    timer = T.setTimeout(() => { timer = null; void flush(); }, ms);
  };

  async function flush() {
    if (disposed || net.status !== 'online') { setState('idle'); return; }
    try {
      const skins = skinsStore.get().entries;
      const json = JSON.stringify(skins);
      if (json === pendingJson) return;
      if (json === lastSent && pendingJson == null) { setState('synced'); return; }
      const my = ++seq;
      pendingJson = json;
      setState('sending');
      try {
        await net.request('room.skins', { skins });
        if (my !== seq) return;
        pendingJson = null;
        lastSent = json;
        setState('synced');
      } catch (err) {
        if (my !== seq) return;
        pendingJson = null;
        const code = err && err.code;
        if (code === 'RATE' || code === 'TIMEOUT' || code === 'OFFLINE') { schedule(RETRY_MS); return; }
        console.warn('[skins] room.skins refused', code, err && err.detail);
        setState('error');
      }
    } catch (e) {
      console.warn('[skins] sync failed', e);
      setState('error');
    }
  }

  const offWelcome = net.on('welcome', () => { lastSent = null; pendingJson = null; seq++; schedule(50); });
  const offStore = skinsStore.subscribe((s, prev) => { if (s.entries !== prev.entries) schedule(); });

  // A skin installed anywhere on this server rewrites data/assets.json for EVERYONE, so the cached copy has to go:
  // a client that keeps the manifest it loaded at boot cannot resolve the new model at all (the skin id the server
  // sends for a teammate's unit would find nothing) and would fall back to the default model for the rest of the
  // session. This is also where an install requested by this player reports back.
  const offChanged = net.on('skins.changed', (msg) => {
    data.invalidate('assets');
    void data.load('assets').catch(() => {});
    const s = skinsStore.get();
    if (s.installing && (!msg || !msg.skinId || msg.skinId === s.installing)) {
      skinsStore.set({ installing: null, installingProgress: null, lastInstalled: msg ? msg.skinId : null, lastInstalledOk: !msg || msg.ok !== false });
    }
  });

  // how far along the install this client asked for is (the requester only — the server sends it to nobody else)
  const offProgress = net.on('skin.progress', (msg) => {
    if (!msg) return;
    const s = skinsStore.get();
    if (s.installing && s.installing !== msg.skinId) return;
    skinsStore.set({ installingProgress: { skinId: msg.skinId, phase: msg.phase, done: msg.done | 0, total: msg.total | 0 } });
  });

  return {
    flush,
    dispose() {
      disposed = true;
      T.clearTimeout(timer);
      offWelcome?.();
      offStore?.();
      offChanged?.();
      offProgress?.();
    },
  };
}
