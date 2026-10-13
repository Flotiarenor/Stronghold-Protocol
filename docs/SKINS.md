# 干员皮肤 (Operator skins)

An operator's Spine model and avatar can be replaced by one of its official alternative outfits (时装). Written to
be **portable**: nearly everything lives in new files, and the handful of edits to existing ones are listed below
line by line so they can be re-applied after merging an upstream release.

> Line numbers are as of the commit that added this document and will drift. The anchor (the enclosing function or
> section) is the durable part.

## How it works

```
tools/skin-library/library-index.json   what the LOCAL CLIENT holds — the three image tiers of every operator, written
        │                               by `extract.py --only library` (part of setup --local). This decides WHICH skins
        │                               exist: 275 on 174 operators, including the 自选编队 pool's operators.
        │
        ├── tools/skin-library/build-catalogue.mjs ──→ data/skins.json   the catalogue the CLIENT reads: id, name,
        │        (tools/build-skins.mjs delegates here)                  series. No URLs — an uninstalled skin has no
        │                                                                 files to point at.
        │
        └── data/skins-local.json ──────────────────→ chars[charId].skins[skinId].spine  the models the same
        │                                               extraction wrote (extract.py `skins` job)
        │
        └── docs/research/08-skins.json   what EXISTS upstream (174 skins / 115 operators) — a static list, like the
        │                                 other research tables; never fetched at build time. Still the source of skin
        │                                 NAMES (agrees with the official table on all 174) and of the mirror URLs.
        │
        └── tools/install-skins.mjs  downloads ONE skin on demand (7 files) and splices it into
                 │                   data/assets.json + data/skins-installed.json
                 │
                 └── server/skinInstall.js   the in-game 「安装」 button, queued (the same work, imported)
                                              │
                     data/assets.json ────────┴──→ chars[charId].skins[skinId] = { spine:{front,back?}, avatar, name, group }

player picks a skin ──→ room.skins ──→ PlayerState.skins ──→ Match.publicView().players[].skins   (PUBLIC: teammates see it)
                                              │
                                              └── battleInput() u.skin ──→ snapshot ──→ renderer ──→ spineEntry(m, id, {skin})
```

Three properties are load-bearing:

- **Skins are installed on demand, never wholesale.** All 174 are ~190 MB, and the upstream link measured ~35 KB/s
  from a mainland China line — a full set would be over an hour. `data/skins-installed.json` starts empty and only
  `tools/install-skins.mjs` adds to it, so a fresh clone downloads no skins at all.
- **The skin *choice* is keyed by chess id; the skin *catalogue* and the asset manifest are keyed by operator id.**
  A chess record is `chess_char_1_01_a` and carries `charId: char_498_inside`. Mixing the two is silent: the picker
  renders an empty section and `setSkins` drops every entry.
- **A skin model must go through the build-time spine pipeline.** `resolveRoles()` runs offline in
  `tools/assets/spine.mjs`, and the client's `validSpine()` requires the `anims` it produces. A model that skipped
  that step fails to load and leaves the unit on its placeholder avatar forever — invisible until someone looks at
  the board. `installSkins()` therefore builds its models through the same `fexliModelDef()` the full plan uses.
- **The extracted page carries the model stem, not the client's own texture name.** The client calls a skin's page
  `<charId>_<series>#<n>.png`, and that name is the one string here that cannot be percent-encoded: pixi-spine reads it
  out of the `.atlas` text and resolves it against the atlas URL itself (`vendor/pixi-spine.js` — the `textures` of the
  manifest are never consulted). A `#` there starts the URL fragment, and PIXI's loader strips everything from the `#`
  on before it picks a parser: the URL left (`…_texas_epoque`) has no `.png`, no image parser matches it, `load()`
  resolves **null without a request**, pixi-spine reads `.baseTexture` of that null and the whole model fails. So
  `extract.py` renames the page file *and* the atlas page line to the stem (`char_102_texas_epoque_7.png`, the same stem
  as the `.skel`/`.atlas`; `url_safe_atlas` / `page_filename`) — every other local-client URL keeps the client's id and
  goes through `asset_url()`, which percent-encodes `#` as `%23`.

One placement rule follows: the 皮肤 section sits directly under the operator's name and above 技能 / 局内数值 / 模组,
with 潜能与练度 last. A skill and a module are usually left on their defaults and the two 潜能 / 练度 selects are a
one-off set-and-forget, while the appearance is what a player opens the panel to change. Both 干员调配
(`screens/loadout.js Detail`) and the 自选编队 picker's detail (`screens/diy.js DiyPickerView`) follow it.

## New files

| Path | What |
|---|---|
| `docs/research/08-skins.json` | Static research table: `{ meta, skins: { [charId]: [{ skinId, stem, name, group, avatar, battleSpine }] } }`. Sources skin NAMES and the mirror URLs; no longer decides which skins exist |
| `tools/skin-library/library-index.json` | What the local client holds: `tiers.avatar/portrait/illust` → asset id → `{ path, w, h, charId, skinId }`. Decides which skins exist |
| `tools/skin-library/build-catalogue.mjs` | `library-index.json` (+ names from the official `skin_table.json` cache) → `data/skins.json` |
| `tools/skin-library/used-operators.mjs` | Reports the library's coverage of the operators the project fields (`chess.json` ∪ `backups.json` `diy`) |
| `tools/build-skins.mjs` | Delegates to `build-catalogue.mjs`; kept so an older command still works |
| `tools/local-skins-meta.mjs` | Metadata (clips, durations, bounds) of the extracted models → `tools/assets/local-skins-meta.json`. Run by `extract.py` after the `skins` job; the client's `validSpine()` needs the clips, so a stale file hides skins |
| `tools/install-skins.mjs` | Install/uninstall skins on demand; `list` / `add` / `remove` / `add-char`. Also the library `server/skinInstall.js` imports |
| `server/skinInstall.js` | Serialised background install queue: why it is queued, why it is never awaited (8 s client timeout) |
| `data/skins.json` | The client's catalogue (no URLs) |
| `data/skins-installed.json` | Which skin ids are installed — the single source of truth the build reads |
| `public/js/ui/skins.js` | Client store + `room.skins` sync + install requests + manifest reload on `skins.changed` |
| `public/js/ui/skinPicker.js` | The 皮肤 section of 干员调配 and of the 自选编队 picker (self-contained: `screens/loadout.js` and `screens/diy.js` only name it) |
| `test/skins.test.js`, `test/skins-protocol.test.js`, `test/ui/skins.e2e.test.js` | Lookup, wire format, real-browser picker |

## Edits to existing files

| File | Where | What |
|---|---|---|
| `shared/protocol.js` | before `isLoadoutEntries` | `SKIN_LIMITS`, `isSkinId`, `isSkinSelection`. **`isSkinId` cannot be `isId`**: that allows only `[A-Za-z0-9_\-.:]` and skin ids carry `@` and `#` |
| `shared/protocol.js` | `C2S` table | `'room.skins'` and `'room.skin.install'` |
| `server/net.js` | `HEAVY_TYPES` | `'room.skins'`, `'room.skin.install'` |
| `server/net.js` | `Session` ctor | `this.skins = null` |
| `server/lobby.js` | import | `installSkinInBackground` |
| `server/lobby.js` | after `freezeLoadout` | `freezeSkins()` — the same gate as `checkLoadout` (`isGolden` / `visible === false` / `isHidden` / `isDiy` / `baseId !== id`) |
| `server/lobby.js` | `onMessage` | `case 'room.skins'` / `case 'room.skin.install'` |
| `server/lobby.js` | after `loadout()` | `skins()` — no phase gate (unlike the loadout: a skin is cosmetic and public) — and `skinInstall()`, which acknowledges at once and broadcasts `skins.changed` to **every** session on completion |
| `server/lobby.js` | `humanSeat()` & `startMatch()` | passes `skins` from session to seat and from room seats to `new Match()` |
| `server/match/Match.js` | after `setLoadout` | `setSkins()` — any phase, `markPublic()` |
| `server/match/Match.js` | `publicView().players[]` | `...(Object.keys(ps.skins).length ? { skins: ps.skins } : {})` — omitted when empty, so the payload is unchanged for players with no skins |
| `server/match/Match.js` | prep view units | `skin: ps.skins?.[rec?.baseId || piece.id] || ps.skins?.[piece.id]` — supports both base and golden/promoted pieces |
| `server/match/PlayerState.js` | ctor | `this.skins = Object.freeze({})` + restore from `seat.skins` |
| `server/match/PlayerState.js` | after `setLoadout` | `setSkins()` — bots refused, same gate as above, calls `this.dirty()` |
| `server/match/PlayerState.js` | `battleInput()` | `const baseId = (rec && rec.baseId) || piece.id; const skin = this.skins[baseId] || this.skins[piece.id]; if (skin) u.skin = skin;` — preserves skin when upgraded to golden |
| `server/match/PlayerState.js` | `pieceView()` | includes `skin` on prep board/hand/temp piece views |
| `server/sim/snapshot.js` | `unitInfo()` | `skin: u.skin ?? undefined` — **`undefined`, not `null`**: `JSON.stringify` drops it, so the `DESIGN §8.2` wire-format contract test still passes and an install with no skins is byte-identical to before |
| `public/js/assets.js` | `spineEntry()` | `opts.skin` → `chars[id].skins[id].spine`, else the operator's own model |
| `public/js/assets.js` | `avatarUrl()` & `hasBackSpine()` | supports `opts.skin` for avatar; `hasBack(id, skinId)` forwards skin |
| `public/js/render/units.js` | `_loadSpine()` & `_loadPicture()` | passes `skin: this.info.skin` to spine and avatar diamond fallback |
| `public/js/render/units.js` | `_wantsBack()` | asks `hasBack(id, this.info.skin)` |
| `public/js/render/app.js` | `pieceInfo()` and `addInfo()` | `skin: piece.skin ?? skinFor(baseId) ?? null` / `skin: u.skin ?? null`; `sig` includes `skin` to drop cache on switch |
| `public/js/data.js` | `DATA_FILES` | `skins: 'skins.json'` |
| `public/js/ui/gameComponents.js` | `GAME_FILES` | `'skins'` — `test/ui/playtest3.test.js` requires every file the in-match UI reads to be awaited by the match screen, and 干员调配 is reachable during a match |
| `public/js/screens/loadout.js` | imports + `Detail()` | import `SkinSection`, then `<${SkinSection} chess=${chess} />`. **Two lines** — the section itself is entirely in `ui/skinPicker.js` |
| `public/js/screens/diy.js` | imports + `DiyPickerView()` | the same two lines in the picker's detail, with `chess=${{ ...base, charId: draft.charId, chessId: slot.slotId }}`: a 自选 slot's own base record is the `isDiy` chess `freezeSkins` and `PlayerBasics.setSkins` accept, and `MatchViews` reads `ps.skins[rec.baseId || piece.id]`, so a slot fielded as its golden form keeps the skin |
| `public/js/main.js` | imports + boot | `installSkinsSync({ net })` |
| `public/css/screens/loadout.css` | end | `.lo-skins` / `.lo-skin` tiles (mirrors `.lo-mods`) |
| `data/assets.json` | — | regenerated; carries `chars[charId].skins` for whatever is installed |

## Regenerating the asset side

```
node tools/build-skins.mjs                                   # → tools/skin-library/build-catalogue.mjs (data/skins.json)
node tools/skin-library/used-operators.mjs                   # which operators the project fields, and the coverage
node tools/install-skins.mjs list [text]                     # what exists / what is installed
node tools/install-skins.mjs add <skinId…>                   # install (resumable; safe to interrupt)
node tools/install-skins.mjs add-char <charId…>              # every skin of those operators
node tools/install-skins.mjs remove <skinId…>                # uninstall (files stay on disk)
npm run assets                                               # rebuilds the manifest from the selection file
```

`tools/fetch-assets.mjs` only builds the skins listed in `data/skins-installed.json`, so a full run never
re-downloads one that was uninstalled **and** removes it from the manifest — matching what the installer writes.

Upstream sources: `fexli/ArknightsResource` (`spine/{charId}/{stem}/{Front,Back}/`) for the models,
`yuanyan3060/ArknightsGameResource` (`avatar/{avatarId}.png`) for the 180×180 thumbnails, and Kengxxiao's
`skin_table.json` for the names and series. Two naming rules, both verified:

```
stem   = skinId.replace(/@/g, '_').replace(/#/g, '_')      char_002_amiya@winter#1 → char_002_amiya_winter_1
avatar = 'avatar/' + encodeURIComponent(avatarId) + '.png'  avatarId comes from skin_table, NOT from the skinId
```

The full skin art (`skin/{portraitId}b.png`) is deliberately **not** used: at ~2.5 MB each it would add ~435 MB,
more than the entire rest of the asset set, for a thumbnail.

## Known limitations

- **No skin effects.** The official per-character battle effects are `.ab` particle bundles that the project does
  not extract (`docs/ASSETS.md`); battle FX stay procedural.
- **No operator voices.** A separate piece of work; the files exist (`ArknightsAssets2`, `voice` branch) but there
  is no event→line mapping or playback path yet.
- **Bots always wear the default model** (`setSkins` refuses bots, as `setLoadout` does).
- **Uninstalling leaves the files on disk.** They are shared between skins and a reinstall would only fetch them
  again; `npm run assets --prune` clears the orphans.
- **Docker images cannot install.** The runtime stage of the `Dockerfile` copies `server/`, `shared/`, `data/`,
  `public/` and `docs/research/` but not `tools/`, which `server/skinInstall.js` imports on demand. Add `tools/` to
  that stage if the in-game button should work there.
- **An install is tens of seconds, not instant.** The seven files come from GitHub at the link's speed; the panel
  acknowledges immediately and reports back through `skins.changed`.
- **Any player in a room may install, and that is deliberate.** `room.skin.install` makes this server download files
  from the internet and rewrite the shared `data/assets.json` every client reads, which is why the upstream maintainer
  closed the original pull request. The answer is not a rank, though: a room's host is simply whoever ran `room.create`,
  which any client can do, so a host check would stop nobody while forcing every teammate to ask the host to click for
  them. What bounds the endpoint is the catalogue — the id must be in `docs/research/08-skins.json`, so the download
  URLs come from a committed table and no client can point the server at an arbitrary URL, and the whole table is 174
  skins / ~148 MB, a fixed cost. On top of that the queue is serial with a cap, `room.skin.install` is a heavy message
  (rate limited per connection), and every player downloads only the skins they actually wear — a few hundred KB each.
- **An operator who wants no installs at all** sets `SP_SKIN_INSTALL=0`; the local
  `node tools/install-skins.mjs add <skinId>` command is unaffected and remains the recommended path.
