// 皮肤选择器 (docs/SKINS.md) — the 皮肤 section of the 干员调配 screen's detail panel.
//
// Self-contained on purpose: screens/loadout.js only imports this and drops `<${SkinSection} chess=… />` into its
// detail body, so upstream rewriting that screen (it is one of the two files most likely to change) costs one
// line here rather than a merge conflict over the whole panel.
//
// Three states per skin, and the difference matters because skins are installed on demand:
//   * installed   → selectable, thumbnails from the asset manifest
//   * not installed → shown, with an 安装 button; picking it would just render the default model, so it is not
//     selectable until its files exist
//   * 默认        → clears the choice (the operator's own model)

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, MicroLabel, Modal, Spinner } from './components.js';
import { useStore, shallowEqual } from '../store.js';
import { data } from '../data.js';
import { toast } from './toasts.js';
import { net as appNet } from '../net.js';
import { skinsStore, availableSkins, loadSkinData, setSkin, clearSkin, requestSkinInstall, libraryImage } from './skins.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * The installed skin's 180×180 avatar URL, or null (a skin with no files on this server has nothing to point at).
 *
 * Keyed by OPERATOR id, not by chess id: data/assets.json groups everything under `chars[charId]`, and the skin
 * catalogue does the same. A chess record carries both (`chess_char_1_01_a` → `charId: char_498_inside`), and
 * getting the two the wrong way round makes the whole section silently empty.
 *
 * The locally extracted manifest is asked first, matching ui/skins.js and assets.js spineEntry: a skin whose model
 * came from the game client carries its avatar there (the one part the client does not yield, so the extractor
 * downloads it), and without this the tile would show the placeholder while a mirror-provided one showed a face.
 * The library (ui/skins.js libraryImage) comes last: it covers every operator the client ships, including the ones
 * data/skins-local.json has no entry for.
 */
function skinAvatar(charId, skinId) {
  return data.get('skinsLocal')?.chars?.[charId]?.skins?.[skinId]?.avatar
    || data.get('assets')?.chars?.[charId]?.skins?.[skinId]?.avatar
    || libraryImage(charId, skinId, 'avatar') || null;
}

/**
 * The skin's 180×360 portrait — the button art — or null.
 *
 * One family covers every skin at one fixed size, which is what makes a grid of tiles line up: the illustration is
 * 1024 px for most skins but 1280 / 1320 / 1416 for a few, so it cannot be the button. A manifest that has not loaded
 * yet leaves the placeholder.
 */
function skinPortrait(charId, skinId) {
  return data.get('skinsLocal')?.chars?.[charId]?.skins?.[skinId]?.portrait
    || libraryImage(charId, skinId, 'portrait') || null;
}

/**
 * The skin's static illustration — the enlarged preview — or null.
 *
 * Only the locally extracted models carry one (the client's `skinpack` page; no mirror ships it), so a skin that
 * only the web download provided falls back to its 180×180 avatar.
 */
function skinIllust(charId, skinId) {
  return data.get('skinsLocal')?.chars?.[charId]?.skins?.[skinId]?.illust
    || libraryImage(charId, skinId, 'illust') || null;
}

/**
 * The enlarged preview: the skin's illustration, and — for the few skins the official table gives TWO illustrations
 * (`spIllustId`: 凯尔希 时遗, 新约能天使 寻翼之歌; docs/SKINS.md) — the second one beside it.
 *
 * A plain component taking URLs rather than the store, so the markup can be tested without a browser.
 * @param {{ art?: string|null, second?: string|null }} props
 */
export function SkinPreview({ art = null, second = null }) {
  if (!art && !second) return null;
  return html`<div class=${cx('lo-skin-preview', second && 'lo-skin-preview--dual')}>
    ${art ? html`<img src=${art} alt="" />` : null}
    ${second ? html`<img src=${second} alt="" />` : null}
  </div>`;
}

/**
 * 皮肤 section for one operator.
 * @param {{ chess: any, net?: any }} props `chess` is the chess record of the detail panel; `net` is injectable for tests
 */
export function SkinSection({ chess, net = appNet }) {
  const s = useStore((v) => v, shallowEqual, skinsStore);
  const [, bump] = useState(0);
  /** The skinId whose illustration is shown enlarged (null = closed); clicking the chosen tile opens it. */
  const [preview, setPreview] = useState(null);
  // Two ids, and they are not interchangeable: the CHOICE is stored per chess (like the loadout, and that is the
  // key the server validates and the renderer reads), while the catalogue and the asset manifest are per operator.
  const chessId = chess && chess.chessId;
  const charId = chess && chess.charId;
  // the catalogue lives in data/skins.json and the installed set in data/assets.json; both may still be loading
  useEffect(() => {
    let dead = false;
    loadSkinData();
    const off = data.subscribe?.(() => { if (!dead) bump((n) => n + 1); });
    const t = setInterval(() => { if (!dead) bump((n) => n + 1); }, 500);
    return () => { dead = true; clearInterval(t); off?.(); };
  }, [chessId]);

  if (!chessId || !charId) return null;
  // No early return for an operator that has no skins: 默认 is an appearance of its own and is always selectable, so
  // the section always renders, with the 默认 tile alone. Six of this mode's 121 operators have no skin, and hiding
  // the section for them made the panel a different shape per operator (the header count is dropped for them too).
  const list = availableSkins(charId);

  const chosen = s.entries[chessId] || null;
  const previewName = preview ? (list.find((x) => x.id === preview)?.name || '') : '';
  // the preview's art: the illustration, else the avatar; plus the second illustration of a two-illustration skin
  const previewArt = preview ? (skinIllust(charId, preview) || skinAvatar(charId, preview)) : null;
  const previewSecond = preview ? (list.find((x) => x.id === preview)?.spIllust || null) : null;
  // The default appearance is a real outfit, so its tile gets real art: the operator's own 180x360 portrait from
  // data/assets.json (a skin's own series means nothing for it). A manifest that has not loaded yet leaves the
  // placeholder, which is what this tile used to show always.
  const defaultArt = data.get('assets')?.chars?.[charId]?.portrait || null;
  const installedCount = list.filter((x) => x.installed).length;
  const sock = net;
  const installing = s.installing || null;
  const prog = s.installingProgress;
  // The seven files are 2 models × (skel + atlas + png) + the avatar, and the installer reports them as they land.
  // Before the first report there is nothing to show but that it started.
  const progLabel = !prog ? '' :
    prog.phase === 'queued' ? t('排队中…') :
    prog.total > 0 ? `${prog.done}/${prog.total}${prog.phase === 'finishing' ? t(' · 解析中…') : ''}` : t('准备中…');

  const install = async (skinId) => {
    if (!sock || installing) return;
    try {
      // acknowledged at once; the outcome arrives as skins.changed (ui/skins.js), which also reloads the manifest
      await requestSkinInstall(sock, skinId);
      toast(t('开始安装，装好后这里会自动出现（网络慢时约一分钟）'), 'info');
    } catch (e) {
      toast(t('安装失败：') + (e && (e.detail || e.code) || t('未知错误')), 'warn');
    }
  };

  return html`<section class="lo-sec lo-sec--skin" data-testid="skin-section">
    <header class="lo-sec__head">
      <h3>${t('皮肤')}<${MicroLabel}>SKIN<//></h3>
      <span class="lo-sec__note">
        ${installing
          ? html`<${Spinner} size="sm" /> ${t('正在安装')} <b class="num">${progLabel}</b>`
          : !list.length ? null
          : t('{installedCount}/{n} 已安装', { installedCount, n: list.length })}
      </span>
    </header>
    <div class="lo-skins" role="radiogroup" aria-label=${t('选择皮肤')}>
      <button type="button" role="radio" aria-checked=${chosen ? 'false' : 'true'} data-skin=""
        class=${cx('lo-skin', 'lo-skin--default', !chosen && 'is-on')} onClick=${() => clearSkin(chessId)}>
        <span class="lo-skin__art">
          ${defaultArt
            ? html`<img src=${defaultArt} alt="" loading="lazy" />`
            : html`<span class="lo-skin__art--none"></span>`}
        </span>
        <span class="lo-skin__text"><b class="lo-skin__name">${t('默认')}</b><span class="lo-skin__group">DEFAULT</span></span>
      </button>
      ${list.map((x) => {
        // The button art: the fixed-size portrait, then the illustration, then the avatar. A skin with an image but no
        // model still shows its art — it is worth looking at — but it is not selectable: the renderer would fall back
        // to the operator's own chibi, so offering the choice would be a promise the files cannot keep.
        const art = (x.installed || x.libraryOnly) ? (skinPortrait(charId, x.id) || skinIllust(charId, x.id) || skinAvatar(charId, x.id)) : null;
        const isBusy = installing === x.id;
        const selectable = x.installed;
        return html`<button key=${x.id} type="button" role="radio" aria-checked=${chosen === x.id ? 'true' : 'false'}
            data-skin=${x.id} disabled=${!!installing || !!x.libraryOnly}
            class=${cx('lo-skin', chosen === x.id && 'is-on', !x.installed && 'lo-skin--missing',
              x.libraryOnly && 'lo-skin--artonly', isBusy && 'is-installing')}
            title=${selectable ? t('点击选择；再点一次放大预览') : x.libraryOnly ? t('这张外观的模型不在本机客户端里，只能预览') : null}
            onClick=${() => (selectable ? (chosen === x.id ? setPreview(x.id) : setSkin(chessId, x.id)) : install(x.id))}>
          <span class="lo-skin__art">
            ${art
              ? html`<img src=${art} alt="" loading="lazy" />`
              : isBusy ? html`<${Spinner} size="sm" />` : html`<span class="lo-skin__art--none"></span>`}
          </span>
          <span class="lo-skin__text">
            <b class="lo-skin__name">${x.name}</b>
            <span class="lo-skin__group">${isBusy ? progLabel
              : selectable ? x.group : x.libraryOnly ? t('仅预览 · 无模型') : t('未安装 · 点击安装')}</span>
          </span>
        </button>`;
      })}
    </div>
    <${Modal} open=${!!preview} title=${previewName || t('皮肤预览')} micro="SKIN PREVIEW" onClose=${() => setPreview(null)} width="min(92vw, 900px)">
      <${SkinPreview} art=${previewArt} second=${previewSecond} />
    <//>
  </section>`;
}
