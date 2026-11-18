# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [2.5.0] - 2026-11-18

### Added
- **Live Telemetry for `NovaOOT / OOT-PC` & `NX2navi` (`launcher/OcarinaAtlas.cs`, `launcher/linux/*`, `src/lib/lichii-server.ts`):** Added read-only direct host VA bridge support (`GuestWindowBase = 0`, `[0x7000000000, 0x8000000000)` `main` validation, `0x100000000n` 4 GiB heap floor) for `ocarina` / `nx2navi` processes across Windows and Linux when port `6545` is not already served externally (e.g. by `NX2Saria`).
- **Global **Hide Completed** Filter & **Show Official Pins** Quick Controls (`src/lib/storage.ts`, `src/components/GlobalStatsDrawer.tsx`, `src/components/PlaceView.tsx`, `src/components/LichiiStatusPanel.tsx`):** Added `hideDoneSlot` across all 15 languages to hide 100%-completed areas in Stats and completed pins in zone/dungeon maps, added **Show official pins** to the Stats drawer, and added **Official pins**, **Only reachable**, and **Hide completed** quick-toggle pills to the Dynamic Island (removing raw XYZ coordinates for a cleaner fullscreen layout).

### Fixed
- **Save-Only Mode Map & Global Progress Sync (`src/lib/useLichiiTracker.ts`):** Enabled `canSyncTelemetryProgress()` for `source === 'save'` so all 184/184 `progress.sav` collectibles and `ownedRequirements` automatically mark map pins and update **Stats / Global Progress** even when no live emulator/recomp RAM bridge is attached (without triggering live pickup toasts or Camera Follow).
- **Collected Marker Visual Contrast (`src/components/Pins.tsx`):** Dimmed completed `OfficialMarker` pins (`opacity-50 hover:opacity-100`) alongside the green checkmark badge so collected vs. uncollected pins stand out immediately.

## [2.4.1] - 2026-11-18

### Fixed
- **Modern Windows Folder Picker (`launcher/OcarinaAtlas.cs`, [#44](https://github.com/antonioalvromero/Ocarina-Atlas/issues/44)):** Replaced the legacy `FolderBrowserDialog` with the native Windows 10/11 `IFileOpenDialog` (`FOS_PICKFOLDERS`) resizable Explorer folder picker with an address bar for pasting paths directly (preserving `FolderBrowserDialog` fallback if COM is unavailable).

## [2.4.0] - 2026-11-18

### Added
- **Saved Save Folders List & Save Slot Selector ([#44](https://github.com/antonioalvromero/Ocarina-Atlas/issues/44)):**
  - Added a persistent **Save Folder** manager (`Add...`, `Remove`, `Auto-detect`) and **Save Slot** selector (`Auto (Latest)` + `slot_00`..`slot_05`) in the **`Settings`** tab of both the Windows (`%APPDATA%\OcarinaAtlas\settings.json`) and Linux AppImage (`~/.config/ocarina-atlas/settings.json`) launchers, plus `--save-dir` / `--save-slot` CLI flags and a live **Save Slot** dropdown in the web map's status card.
  - Added 4-level save root resolution (`game root` including `LongshotLauncher-data/user/save` & `profile/save`, `user/save`, `<uid>`, or direct `slot_XX`) and live switching via `POST /api/saves/slot`.
- **15-Language Launcher Localization:** Added all 15 supported languages (`en`, `es`, `fr`, `pt`, `zh-CN`, `zh-TW`, `de`, `it`, `ja`, `ko`, `nl`, `ru`, `pl`, `tr`, `uk`) with OS locale auto-detection and a `Language` selector in `Settings` for both Windows and Linux AppImage launchers.

### Fixed
- **Windows Tray Restore & Settings Persistence (`launcher/OcarinaAtlas.cs`):** Fixed `Minimize to tray` freezing/closing on restore by removing dynamic `ShowInTaskbar` handle recreation, added single-click tray restore, persisted all launcher settings (`port`, `lichiiHost`, `lichiiPort`, `allowLan`, `autoOpenBrowser`, `minimizeToTray`, `language`, `savedSaveDirs`) while preserving explicit CLI flag priority, and added custom `DarkComboBox` styling for all Windows dropdowns.
- **Linux Settings Restore (`launcher/linux-appimage/main.cjs`):** Persisted and restored `lichiiHost` and `lichiiPort` across restarts.

## [2.3.1] - 2026-11-17

### Fixed
- **Windows Launcher High-DPI Scaling (`launcher/OcarinaAtlas.cs`):** Configured `AutoScaleDimensions = new SizeF(96F, 96F)` with `AutoScaleMode.Dpi` and `SuspendLayout()` / `ResumeLayout()` across `MainForm`, `UpdateDialog`, and the QR modal, scaled `ReflowLayout()` bounds and `BorderedPanel` corner radii by system DPI (`Theme.GetDpiScale`), and moved `AutoSize`-relative label alignment to `AlignAutoSizedPairs()` after layout so controls and text never clip on 125%–200%+ Windows display scaling.

## [2.3.0] - 2026-11-17

### Added
- **HeyListen Support ([#37](https://github.com/antonioalvromero/Ocarina-Atlas/issues/37)):** Added live read-only memory bridge detection (`HeyListen.exe` / `heylisten`) and `user/save` auto-discovery across Windows, Linux, `README.md`, and `src/lib/lichii-server.ts`.
- **NX2Saria Support ([#40](https://github.com/antonioalvromero/Ocarina-Atlas/pull/40)):** Added native `NX2Saria` live RPC (`127.0.0.1:6545`) detection, `NX2SARIA_SAVE_DIR` / `profile` save-slot fallback, `NX2Saria` UI/launcher labeling, and dynamic 4 GiB heap floor (`getMinGuestHeapPtr`) courtesy of `@Larbaco`.
- **15-Language Localization & Browser Auto-Detection ([#39](https://github.com/antonioalvromero/Ocarina-Atlas/issues/39)):** Expanded `src/lib/i18n.ts` from 4 to 15 languages (`en`, `es`, `fr`, `pt`, `zh-CN`, `zh-TW`, `de`, `it`, `ja`, `ko`, `nl`, `ru`, `pl`, `tr`, `uk`) with full UI, place, region, category, and gear labels plus `navigator.language` auto-detection fallback (SSR-safe). *(Translations were produced with AI assistance and may contain minor wording errors; PRs are welcome.)*
- **Experimental Linux x64 AppImage Desktop Launcher (`OcarinaAtlas-Linux-x64.AppImage`):** Added a self-contained Electron `.AppImage` launcher mirroring the Windows Hyrule Dark UI, with bundled read-only `longshot-rpc-bridge`, Wine/Proton `.exe` & 15-char `comm` matching, expanded Wine/Steam/Flatpak/Bottles/Heroic/Lutris save discovery, PID-reuse protection, and a `kernel.yama.ptrace_scope` helper banner. *(Experimental — not yet 100% tested across all Linux setups; feedback via Issues/PRs is welcome.)*

### Improved
- **World Map & Mobile/Tablet Rendering Performance:** Replaced full-viewport `blur-2xl` backdrop filtering with a lightweight radial gradient, switched `MapViewport` and `PlayerPin` to GPU-composited `translate3d` transforms, removed heavy SVG drop-shadow / backdrop-blur layers on interactive map surfaces, cached pointer-down bounds, and stabilized marker callbacks for smooth panning and zooming on older/low-RAM devices.

## [2.3.0-linux.2] - 2026-11-16 (Pre-release / Experimental Linux Support)

> **Experimental Pre-release (`v2.3.0-linux.2`).** Includes the [`v2.2.2`](#222---2026-11-16) Lon Lon Ranch Gold Skulltula fix (`#34`) and [`v2.2.1`](#221---2026-11-16) chest Heart Piece fix (`#33`) alongside the experimental, untested-on-real-hardware Linux x64 bundle (`OcarinaAtlas-Linux-x64.tar.gz`) and Windows x64 bundle (`OcarinaAtlas-Windows-x64.zip`).

### Fixed
- **Lon Lon Ranch Gold Skulltula Swap (`src/lib/lichii-server.ts`, [#34](https://github.com/antonioalvromero/Ocarina-Atlas/issues/34)):** Swapped `lonlon-gs-02` (`0x7d8ec14bdd1f6341n` / `...6343n`) and `lonlon-gs-04` (`0x25e6072d4df023b3n` / `...23b1n`) actor hashes in `KNOWN_SKULLTULA_HASH_MAP` (also confirmed [#33](https://github.com/antonioalvromero/Ocarina-Atlas/issues/33) chest Heart Pieces resolved since `v2.2.1`).

## [2.3.0-linux.1] - 2026-11-16 (Pre-release / Experimental Linux Support)

> **Experimental Pre-release (`v2.3.0-linux.1`).** Introduces experimental, untested-on-real-hardware Linux x64 support (`OcarinaAtlas-Linux-x64.tar.gz`) alongside the portable Windows x64 bundle (`OcarinaAtlas-Windows-x64.zip`). Windows `OcarinaAtlas.exe` stays at `2.2.1` so stable Windows testers remain cleanly upgradable to `v2.3.0`.

### Added
- **Portable Linux x64 Bundle & CLI Launcher (`launcher/linux/OcarinaAtlas`, `launcher/linux/ocarina-atlas-cli.mjs`, `scripts/build-linux.mjs`):** Added self-contained `OcarinaAtlas-Linux-x64.tar.gz` packaging bundling Node.js 24, `standalone-server.mjs`, `dist/`, and the `./OcarinaAtlas` launcher (`--port`, `--host`, `--lan` default `0.0.0.0`, `--local-only`, `--lichii-host`, `--lichii-port`, `--no-browser`, `--setup-sync`, `--help`).
- **Read-Only Linux Recomp Memory Bridge (`launcher/linux/longshot_rpc_bridge.c` -> `runtime/longshot-rpc-bridge`):** Added a native C99 POSIX utility using `process_vm_readv()` (with read-only `/proc/<pid>/mem` fallback) against `0x100000000000` guest mappings for Linux Longshot, Hookshot, Project ReLink, and Triforce processes, serving loopback JSON-RPC on `127.0.0.1:6545` with `kernel.yama.ptrace_scope` diagnostics.
- **Linux XDG Save-Slot Auto-Discovery (`src/lib/lichii-server.ts`, `src/lib/lichii-server.test.ts`):** Added `$XDG_DATA_HOME/{fritchii,lichii,eden,cheezyemu}/nand/user/save/0000000000000000` (default `~/.local/share/...`) alongside existing Windows `%APPDATA%` and `~/Games/...` save paths.
- **Dual-Platform CI & Release Packaging (`.github/workflows/ci.yml`, `.github/workflows/release-windows.yml`, `scripts/smoke-test-linux.sh`, `scripts/generate-release-notes.mjs`, `src/lib/release-notes.ts`):** Added `build-linux` CI + smoke verification, `package-linux` release job with `.sha256` + build provenance attestation, and multi-asset Windows + Linux release notes and checksum tables.

## [2.2.2] - 2026-11-16

### Fixed
- **Lon Lon Ranch Gold Skulltula Swap (`src/lib/lichii-server.ts`, [#34](https://github.com/antonioalvromero/Ocarina-Atlas/issues/34)):** Swapped `lonlon-gs-02` (`0x7d8ec14bdd1f6341n` / `...6343n`) and `lonlon-gs-04` (`0x25e6072d4df023b3n` / `...23b1n`) actor hashes in `KNOWN_SKULLTULA_HASH_MAP`. *(Related: [#33](https://github.com/antonioalvromero/Ocarina-Atlas/issues/33) chest Heart Pieces resolved in `v2.2.1`.)*

## [2.2.1] - 2026-11-16

### Added
- **Triforce & CheezyEmu Support (`launcher/OcarinaAtlas.cs`, `src/lib/lichii-server.ts`, `src/lib/lichii-types.ts`, `src/components/LichiiStatusPanel.tsx`):** Added zero-config read-only `LongshotRpcBridge` support and `TRIFORCE_SAVE_DIR` auto-discovery for **Triforce** (`Triforce.exe`), plus **CheezyEmu** (`cheezyemu.exe`) support with 1-click `%APPDATA%\cheezyemu\nx2_switches.txt` sync configuration and `CHEEZYEMU_SAVE_DIR` save-slot discovery.
- **Optional Gear Prerequisite Filter & Live Auto-Sync (`src/lib/prerequisites.ts`, `src/components/GearChecklistModal.tsx`, `src/components/Panels.tsx`, `src/lib/lichii-server.ts`, `src/lib/useLichiiTracker.ts`):** Added an **Only reachable** toggle and **My Gear (`N/33`)** checklist modal covering all 33 equipment, gear, song, and situational prerequisites (ignoring day/night requirements), with tier implications (`longshot` -> `hookshot`, `golden-scale` -> `silver-scale`, `golden-gauntlets` -> `silver-gauntlets` -> `goron-bracelet`), per-spot planted Magic Bean matching, and optional live RAM / save auto-sync.
- **Credits & About Sections (`src/components/CreditsModal.tsx`, `launcher/OcarinaAtlas.cs`, `src/components/WorldMap.tsx`, `src/components/PlaceView.tsx`):** Added attribution for `antonioalvromero`, `lucasriondel`, `Nintendúo`, and the official GitHub repository link (`https://github.com/antonioalvromero/Ocarina-Atlas`) in both the Web Map **Credits** modal and `OcarinaAtlas.exe`'s new **About** tab.

### Fixed & Improved
- **Persistent Map Zoom (`src/components/MapViewport.tsx`, `src/lib/storage.ts`):** Preserved the active map zoom scale (`zoomSlot`) across floor switches and zone changes while keeping **Reset View** (and compact-viewport fullscreen exit) resetting zoom cleanly.
- **Auto-Tracking Fixes (`src/lib/lichii-server.ts`):** Fixed tracking for all 6 `Obj_TBox` chest Pieces of Heart via `IsTreasureBoxOpen.*` flags (including Dampé's race and the Gerudo bridge chest) and added Child-age `HaveReadHrlField_Note12_1..3` flag support for `llanura-thought-03`.

### Security & Licensing
- **GNU AGPL-3.0, PE Assembly Metadata & Updater Integrity (`LICENSE`, `launcher/OcarinaAtlas.cs`, `.github/workflows/release-windows.yml`, `README.md`):** Relicensed newly authored Ocarina Atlas components under **GNU AGPL-3.0**, added PE assembly metadata attributes (`AssemblyTitle`, `AssemblyCompany`, `AssemblyProduct`, `AssemblyCopyright`, `AssemblyVersion`, `AssemblyFileVersion`) to `OcarinaAtlas.exe`, enforced official GitHub release hosts and `.sha256` archive verification with CI build provenance attestation (`actions/attest-build-provenance`), and rejected `prerelease` / `draft` payloads in `UpdateManager.ParseReleaseJson()`.

## [2.2.0] - 2026-11-16

### Added
- **Project ReLink & Hookshot Support (`launcher/OcarinaAtlas.cs`, `src/lib/lichii-server.ts`, `src/lib/lichii-types.ts`, `src/components/LichiiStatusPanel.tsx`):** Expanded zero-config read-only live memory telemetry (`LongshotRpcBridge`) and save-slot auto-discovery to [Project ReLink](https://github.com/pixl27/ProjectReLink) (`relink-game.exe` / `relink.exe`, `RELINK_SAVE_DIR`, `~/Games/ProjectReLink/...`, `~/Games/ReLink/...`) alongside [Hookshot](https://git.notrexed.dev/Hookshot/Hookshot) and [Longshot](https://git.magicbean.dev/MagicBeanDev/Longshot).
- **Fullscreen World Map Button (`src/components/PlaceView.tsx`, `src/components/MapViewport.tsx`, `src/components/FloorGrid.tsx`, `src/lib/i18n.ts`):** Added a fullscreen-only World Map navigation button (`<Link to="/">`) with a custom Hyrule folded-map + Triforce icon positioned directly above the zoom controls on all devices.
- **Fullscreen Skulltula Counter & Tracker (`src/components/PlaceView.tsx`, `src/components/WorldMap.tsx`, `src/components/LichiiStatusPanel.tsx`):** Kept the circular Skulltula tracker medallion visible and fully interactive in fullscreen mode, with `fullscreenToastTop` offsetting pickup toasts below stacked top-right controls.

### Fixed & Improved
- **Desktop Fullscreen Guide Scrollbar (`src/styles.css`, `src/components/PlaceView.tsx`):** Added `.hyrule-scrollbar` (`@media (pointer: fine)`) styling matching the Hyrule dark/parchment/gold theme for guide popovers and sidebars on PC.
- **Mobile/Tablet Fullscreen Scroll-Up Exit Bug (`src/styles.css`, `src/components/PlaceView.tsx`):** Prevented overscroll/scroll-chaining at `scrollTop === 0` inside pin guide popovers (`overscroll-behavior: contain`, `touch-pan-y`, `onWheel` `stopPropagation`) from exiting fullscreen when scrolling guide text on phones and tablets.
- **Fullscreen Layout, Mobile Exit Reset & iOS Safe-Area Polish (`src/components/PlaceView.tsx`, `src/components/WorldMap.tsx`, `src/components/MapViewport.tsx`, `src/routes/__root.tsx`):** Placed the Child/Adult (`nino`/`adulto`) map toggle directly below **Exit fullscreen**, automatically ran `resetView()` when exiting fullscreen on compact viewports so the map never overlaps the tracking panel, and added `viewport-fit=cover`, PWA meta tags, `h-dvh`, and `env(safe-area-inset-*)` offsets for iPhone/iPad Safari.

## [2.1.0] - 2026-11-16

### Added
- **Longshot (Native PC Recompilation) Compatibility (`launcher/OcarinaAtlas.cs`, `src/lib/lichii-server.ts`, `src/lib/lichii-types.ts`, `src/components/LichiiStatusPanel.tsx`):** Added zero-config read-only support for [Longshot](https://git.magicbean.dev/MagicBeanDev/Longshot) (`longshot.exe` / `hookshot.exe`):
  - `LongshotRpcBridge` in `OcarinaAtlas.exe` opens the running game process strictly read-only (`PROCESS_VM_READ | PROCESS_QUERY_INFORMATION`), inspects the `A64_HOST_BASE` (`0x100000000000`) guest window via `VirtualQueryEx` / `ReadProcessMemory`, and serves an automatic loopback JSON-RPC bridge on `127.0.0.1:6545` (`status`, `read_memory`, `search_memory` with `0x1000000000+` heap fallback) while releasing the port on exit.
  - Lowered backend guest heap validation (`MIN_GUEST_HEAP_PTR = 0x1000000000n` for `HOS_HEAP_BASE`), added `LONGSHOT_SAVE_DIR` and `<user>/save/<uid>/slot_*` save-slot fallback discovery, and added unit tests in `src/lib/lichii-server.test.ts`.
- **Inside the Deku Tree 2-Point SVG Calibration (`src/lib/lichii-server.ts`):** Calibrated `InsideTheDekuTree` / `DekuTree` (`scaleX: 8.5609, cx: 733.86, scaleZ: 8.9211, cz: 139.64`) across all dungeon floors (`3F`, `2F`, `1F`, `B1`, `B2`).

## [2.0.0] - 2026-11-14

### Added
- **100% Live Collectible Auto Tracking (`184 / 184`):** Added authoritative live RAM (`GameDataMgr + 0x170` `Bool` & `+ 0x230` `Int` flags + `masterTable` Skulltula hashes) and `SaveBuf` / `progress.sav` fallback tracking across all 7 categories: 100 Gold Skulltulas, 36 Pieces of Heart, 8 Heart Containers, 10 Magic Beans, 6 Great Fairies, 5 Bottles (including Big Poe coupon threshold `>= 500`), and 19 Fairy Thoughts, with pickup toasts and automatic reconciliation on save reload.
- **Multi-Language Support (`EN` / `ES` / `FR` / `PT`):** Added type-safe `i18n` (`src/lib/i18n.ts`), `LanguageSelector` in the Atlas and place sidebars, and full translations (`src/data/i18n/{es,fr,pt}.json`) for all UI controls, 7 categories, 32 zones/dungeons (including all 32 place guides), 35 requirements, and all 184 item names, descriptions, and hints.
- **Live Camera Follow (`MapViewport`, `WorldMap`, `PlaceView`):** Enabling **Follow Link** now keeps Link smoothly centered as he moves even when deeply zoomed in (while preserving your zoom level and pausing briefly during manual pointer drags).
- **Interactive Category Cards (`GlobalStatsDrawer`):** Click any category card in **Global Progress** to filter `Remaining` or `All` items and jump directly to the item's zone, floor, and pin.

### Changed
- **Fritchii-Inspired Hyrule Launcher UI (`OcarinaAtlas.exe`):** Redesigned `launcher/OcarinaAtlas.cs` with native Windows dark titlebars (`DWMWA_USE_IMMERSIVE_DARK_MODE`), subtle `Ink700` borders, `Theme.Gold` Hyrule accents, a clean 3-zone layout (borderless header with `Server`/`Emulator` pills, unified Control + Sync card with live telemetry strip, compact `Second Screen (LAN)` card with `QR Code` modal), tabbed `Settings` | `Logs` drawer, inline feedback instead of success popups, and Markdown rendering in `UpdateDialog`.
- **Auto Tracking Rename & Category Cleanup:** Renamed **Auto-Skulltula** to **Auto Tracking** in the UI to reflect 184/184 coverage, and removed the unused empty `Keys` (`0 / 0`) category from `oot.json` and `progress-stats.ts`.
- **Performance & Networking Optimizations:** Added a shared `120 ms` SSE broadcaster (`sseClients`), precomputed contiguous `GameDataMgr` read windows (`buildGdmBoolWindows`), parallelized independent RPC memory reads, added weak `ETag`/`304 Not Modified` caching in `scripts/server-entry.ts`, and split `useLichiiPosition()` / `LivePlayerPin` subscriptions to eliminate full-tree React re-renders on `120 ms` ticks.

## [1.2.1] - 2026-11-14

### Fixed
- **Overworld, Dungeon & Hyrule Field Sub-Region Calibration (`src/lib/lichii-server.ts`):** Aligned live player pin projection using SVG `viewBox` centers, calibrated 2-point `captureByMapId` transforms across major overworld towns, castles, and dungeons, and added `HyruleField` sub-region routing (`GerudoValley`, `LakeHylia`, `LonLonRanch`, `ZorasRiver`).
- **Persistent Fullscreen Across Zone Transitions (`src/lib/useFullscreenMap.ts`):** Preserved browser fullscreen and map-only mode across client-side route navigation on mobile, tablet, and desktop when moving between zones with `followPlayer` enabled.

## [1.2.0] - 2026-11-13

### Added
- **Fritchii (Switch 2 Emulator) Support (`src/lib/lichii-server.ts`, `launcher/OcarinaAtlas.cs`, `README.md`):** Added full read-only live telemetry and save-slot fallback support for [Fritchii](https://github.com/Frizti/Fritchii) alongside Lichii, including automatic `%APPDATA%\fritchii` / `%APPDATA%\lichii` profile detection and 1-click `nx2_switches.txt` sync setup in `OcarinaAtlas.exe`.
- **Mobile & Tablet Fullscreen / Landscape Mode (`src/components/WorldMap.tsx`, `src/components/PlaceView.tsx`, `src/lib/useFullscreenMap.ts`):** Added a **Fullscreen** (`Exit fullscreen`) map-only toggle that hides the header and sidebar, a landscape-optimized layout for phones and tablets, and a tap-a-pin info popover (`data-pin-popover`) that dismisses automatically when tapping outside.

## [1.1.4] - 2026-11-13

### Fixed
- **In-App Auto-Updater (`launcher/OcarinaAtlas.cs`):** Fixed `MainForm.AppVersion` mismatch across releases and hardened the PowerShell swap script with lingering process cleanup (`OcarinaAtlas.exe` / `node.exe`), automatic backup & rollback, per-file retry copy, post-copy executable verification, and `%LOCALAPPDATA%\OcarinaAtlas\update.log` diagnostics.

## [1.1.3] - 2026-11-13

### Added
- **Global Progress Stats Drawer (`src/components/GlobalStatsDrawer.tsx`, `src/lib/stats.ts`):** Added a `Stats` button and completion progress bar in the world-map header with a full breakdown (`X / 184`) across all categories and locations.
- **Verified Heart Container Tracking (`src/lib/lichii-server.ts`):** Added verified master flag table hash tracking for the Spirit Temple boss Heart Container (Twinrova).
- **UI Preview Screenshots (`README.md`, `assets/screenshots/`):** Added crisp `1440x900` world-map and Spirit Temple screenshots and updated feature documentation for the public community release.

## [1.1.2] - 2026-11-13

### Added
- **In-App Auto-Updater (`launcher/OcarinaAtlas.cs`):** Added `UpdateDialog` with release notes preview, **Skip Version** persistence (`%LOCALAPPDATA%\OcarinaAtlas\skipped-version.txt`), and 1-click **Update Now** self-update (ZIP download with progress bar, `System.IO.Compression.ZipFile` extraction, detached PowerShell file swap, and automatic relaunch), plus `--update-feed <url>` / `OCARINA_ATLAS_UPDATE_URL` override support.

## [1.1.1] - 2026-11-13

### Fixed
- **QR Code Pairing Encoding (`launcher/OcarinaAtlas.cs`):** Fixed ISO/IEC 18004 QR code generation (version/EC table, format/version info placement, and masking) so phone and tablet cameras reliably scan the LAN pairing QR code, and added a click-to-enlarge modal preview.

### Changed
- **Web & PWA Ocarina Atlas Branding (`src/routes/__root.tsx`, `src/routes/$zone.tsx`, `src/components/WorldMap.tsx`, `public/manifest.webmanifest`, `public/icons/*`):** Replaced remaining **Field Atlas** page titles, map header, and PWA manifest names with **Ocarina Atlas**, updated `<link rel="icon">` to `/icons/favicon.ico` and `/icons/icon-192.png`, and regenerated all web/PWA icons from `assets/logo.png` and `launcher/OcarinaAtlas.ico`.

## [1.1.0] - 2026-11-13

### Added
- **Real-Time SSE Telemetry Streaming (`/api/lichii/stream`):** Replaced fixed-interval client polling with Server-Sent Events (`text/event-stream`) backed by live memory/save state change detection, reducing latency and idle HTTP traffic while retaining automatic reconnect fallback.
- **PC ↔ Tablet Pin & Progress Sync (`/api/sync/state`):** Added server-mediated state synchronization (`GET`/`POST /api/sync/state`) so collected Gold Skulltulas, official item completion, revealed pins, and custom pins stay synchronized in real time between the PC browser and paired second-screen devices.
- **Second-Screen QR Code Pairing (`launcher/OcarinaAtlas.cs`):** Added a self-contained C# 5 Byte-mode QR Code generator (`QrCodeEncoder`) and compact QR preview inside **Step 2 · Play on Another Device (Optional)** synced to the active LAN URL and port for instant phone/tablet scanning.
- **Non-Blocking GitHub Release Update Check (`launcher/OcarinaAtlas.cs`):** Added a startup background check (4s timeout, TLS 1.2) against GitHub Releases that surfaces a subtle `Update available: vX.Y.Z` link in the Hero header when a newer version is published, failing silently when offline or rate-limited.
- **Project Logo & Windows Icon (`assets/logo.png`, `launcher/OcarinaAtlas.ico`):** Added official Ocarina Atlas branding assets for the repository README and Windows launcher executable.

### Changed
- **Client, Server & Vite Optimizations (`src/lib/lichii-server.ts`, `src/lib/useLichiiTracker.ts`, `vite.config.ts`):** Improved telemetry streaming, server/build performance, and Vite integration.
- **Documentation Refresh (`README.md`, `CONTRIBUTING.md`, `SECURITY.md`):** Rewrote `README.md` with the new hero logo, official-release caution callout, updated launcher UI labels, collapsible CLI/environment reference, and refreshed cross-links across `CONTRIBUTING.md` and `SECURITY.md`.

## [1.0.3] - 2026-11-12

### Changed
- **Unified Ocarina Atlas Naming (`OcarinaAtlas.exe`, `OcarinaAtlas-Windows-x64.zip`):**
  - Renamed the Windows launcher (`launcher/OcarinaAtlas.cs` -> `OcarinaAtlas.exe`), portable bundle folder (`OcarinaAtlas-Windows-x64`), release ZIP (`OcarinaAtlas-Windows-x64.zip`), CI/release workflows, smoke test, and documentation to consistently use **Ocarina Atlas**.
- **Modern Plug & Play Launcher Redesign (`launcher/OcarinaAtlas.cs`):**
  - Redesigned `MainForm` into clean Hyrule-themed cards: Hero status card (**Start Map / Stop Map**, **Open in Browser**, live Lichii indicator), **Step 1 — Lichii Live Sync** (`1-Click Setup Lichii`), **Step 2 — Second Screen (LAN)** (`Copy URL`, explicit `Allow LAN Access`), and a collapsible **Advanced Settings & Logs** drawer.
- **Multi-NIC & Accurate LAN IP Selection (`launcher/OcarinaAtlas.cs`, `src/lib/server-network.ts`):**
  - Added Win32 `GetBestInterface` default-route detection, IPv4 metric/gateway ranking, and expanded virtual/VPN/CGNAT filtering (`Tailscale`, `ZeroTier`, `WireGuard`, `NordLynx`, `Radmin`, `vEthernet`, `169.254.*`, `100.64–127.*`).
  - Added a LAN adapter `ComboBox` selector and **Refresh** button in `OcarinaAtlas.exe` when multiple active LAN networks are present (such as Ethernet + Mesh Wi-Fi).

## [1.0.2] - 2026-11-12

### Added
- **Local Network / Second-Screen Access (`src/lib/server-network.ts`, `scripts/server-entry.ts`, `launcher/OcarinaMaps.cs`, `vite.config.ts`):**
  - Enabled LAN browser access (`0.0.0.0` default bind) so any tablet, iPad, phone, or secondary PC on the same local network can open the live tracker UI seamlessly.
  - Added detected **LAN / Tablet URL** display, 1-click **Copy URL**, an **Allow LAN access** toggle (plus `--lan`, `--local-only`, and `--host` CLI flags), and an optional elevated **Allow Firewall (:port)** helper scoped strictly to Private networks (`profile=private`) in `OcarinaMaps.exe`.
  - Updated standalone server startup output to print reachable `LAN http://<ip>:<port>` URLs prioritizing physical Wi-Fi/Ethernet adapters over virtual interfaces (`vEthernet`, `WSL`, VPN tunnels), and included the PC hostname alongside `.local` in Vite `allowedHosts`.

### Changed
- **Compact Gold Skulltula Tracker Orb (`src/components/LichiiStatusPanel.tsx`, `src/components/LichiiStatusPanel.test.ts`):**
  - Replaced the always-open bottom-left tracker bar with a `56px` circular Gold Skulltula medallion displaying live Skulltula count and a perimeter status indicator dot (`animate-ping` green pulse when live, amber for waiting/save, ember on error, muted when disconnected), keeping Gold Skulltula pickup toasts independent at top-right.
  - Added smooth hover/focus expansion on desktop (with a continuous `pb-2` hover bridge, `180 ms` leave grace delay, keyboard `Escape` support, and `prefers-reduced-motion` support) plus tap-to-toggle pinning and outside-tap/header-close dismissal for touch devices.
- **Lichii-Style Release Notes (`src/lib/release-notes.ts`, `scripts/generate-release-notes.mjs`, `.github/release-notes-instructions.md`):**
  - Standardized release bodies around `## Changes since <prevTag>`, commit span metadata (`Built from ...`), a bold-led callout blockquote, clean category sections (`### New features`, `### Bug fixes`, `### Telemetry & Map Tracking`, `### Windows Launcher`, `### Stability, docs & CI`), `## Downloads` metadata, and a `## Windows` portable ZIP checksum table.

### Security
- **LAN HTTP & Service Worker Hardening (`src/lib/server-network.ts`, `scripts/server-entry.ts`, `src/routes/__root.tsx`):**
  - Added `sanitizeHostHeader()` validation before HTTP URL parsing and guarded `navigator.serviceWorker.register('/sw.js')` cleanly on non-HTTPS LAN origins.
- **Release Pipeline & API Hardening (`scripts/generate-release-notes.mjs`, `.github/workflows/release-windows.yml`, `src/lib/release-notes.ts`):**
  - Switched Gemini API authentication from URL query parameter (`?key=...`) to the `x-goog-api-key` HTTP header.
  - Added secret redaction and structured HTTP error parsing (`sanitizeSecretText`, `formatSafeHttpError`) so API keys, tokens, and raw upstream error bodies cannot appear in logs.
  - Pinned all GitHub Actions in `release-windows.yml` to immutable 40-character commit SHAs, separated build (`contents: read`) from release publishing (`contents: write`), removed raw secret values from metadata detection steps, and validated git refs, repo slugs, and model names before command/URL usage.

## [1.0.1] - 2026-11-11

### Added
- **MIT License (`LICENSE`):** Added an explicit permissive MIT License covering newly authored **Ocarina Atlas** telemetry, Windows launcher, automation scripts, and documentation, alongside co-author credit for Antigravity AI in `README.md`.
- **AI-Assisted Release Notes Automation (`.github/workflows/release-windows.yml`, `scripts/generate-release-notes.mjs`, `src/lib/release-notes.ts`, `.github/release.yml`, `.github/release-notes-instructions.md`):**
  - Supports automated AI release summaries via GitHub Copilot (`COPILOT_GITHUB_TOKEN` with `github/copilot-release-notes`), Google Gemini (`GEMINI_API_KEY`), or OpenAI (`OPENAI_API_KEY`), falling back cleanly to `CHANGELOG.md` + grouped commit notes and GitHub auto-generated PR notes.
  - Embeds the portable `OcarinaMaps-Lichii-Windows-x64.zip` SHA-256 verification digest in every release body.

## [1.0.0] - 2026-11-11

### Added
- **Live Lichii Telemetry Bridge (`src/lib/lichii-server.ts`, `src/lib/lichii-types.ts`, `vite.config.ts`):**
  - Connects to Lichii's JSON-RPC debug server (`127.0.0.1:6545`, configurable via `LICHII_HOST` and `LICHII_PORT`) for live memory polling.
  - Implements Switch NSO ASLR-invariant `MOD0` base discovery and `.bss` singleton dereferencing (`Sub[36]`, `GameDataMgr`, `masterTable`) with heap fallbacks so live tracking recovers automatically across emulator restarts.
  - Projects 3D `(X, Y, Z)` coordinates and `yaw` heading onto all 32 Hyrule zones and dungeon floor SVG `viewBox` maps plus the World Map.
  - Automatically identifies all 100 Gold Skulltulas via exact collected actor ID hashes (`masterTable` / `0xa3db7114` mapped in `KNOWN_SKULLTULA_HASH_MAP`) and `PouchData.Item_Token_Gold.StockNum`, reconciling save reloads cleanly without proximity guessing.
  - Falls back cleanly in read-only mode to the newest local save slot (`caption.sav` / `progress.sav`, configurable via `LICHII_SAVE_DIR`) when RPC `:6545` is unavailable.
- **Live Map UI & Auto-Marking (`src/lib/useLichiiTracker.ts`, `src/components/PlayerPin.tsx`, `src/components/LichiiStatusPanel.tsx`):**
  - Added glowing Triforce `PlayerPin` with animated directional vision cone, floor indicator, 3D coordinates tooltip, and non-live `(Saved)` mode distinction across `WorldMap`, `PlaceView`, and `FloorGrid`.
  - Added bottom-left `LichiiStatusPanel` displaying connection state (`Lichii · Live`, `Lichii · Waiting for game`, `Lichii · Save only`, `Lichii · Disconnected`), current zone/floor/age, `skulltulaCount/100`, **Go to Link**, **Follow Link**, **Auto-Skulltula**, retry controls, and Gold Skulltula pickup toast notifications.
  - Automatically marks and reveals collected Gold Skulltulas in browser `localStorage` (`officialDoneSlot` / `officialRevealedSlot`) and synchronizes floor/route navigation when **Follow Link** is enabled.
- **Standalone Production Server (`scripts/server-entry.ts`, `npm run server:build`):**
  - Bundles a zero-`node_modules` Node HTTP server (`dist/standalone-server.mjs`) serving `/api/lichii/state`, static assets with path-traversal protection, and TanStack Start SSR routes from `dist/client/` and `dist/server/`.
- **Windows Plug & Play Desktop Launcher & Packager (`launcher/OcarinaMaps.cs`, `scripts/build-win.mjs`, `npm run build:win`):**
  - Native C# WinForms GUI (`OcarinaMaps.exe`) featuring Start/Stop controls, auto-open browser option, system tray minimize support, live RPC `:6545` diagnostics, 1-click `%APPDATA%\lichii\nx2_switches.txt` (`EDEN_NX2_DEBUG_SERVER=127.0.0.1:6545`) setup, activity log, CLI flags, and Windows Job Object child-process cleanup.
  - Automated Windows build script generating `release/OcarinaMaps-Windows-x64/` and `release/OcarinaMaps-Lichii-Windows-x64.zip`.
- **Open-Source Community & CI Setup:**
  - Rewrote `README.md` with Plug & Play Windows guide, developer docs, architecture overview, and upstream attributions for **Ocarina Atlas**.
  - Added `AGENTS.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, GitHub issue/PR templates, and GitHub Actions CI (`ci.yml`) and Windows release (`release-windows.yml`) workflows.

### Changed
- Standardized all tracker UI strings, status badges, and floor labels (`1F`–`5F`, `B1`–`B4`, `Child`, `Adult`, `Main`) into English across `src/lib/data.ts`, `src/components/LichiiStatusPanel.tsx`, `src/components/PlayerPin.tsx`, and `src/components/PlaceView.tsx`.
- Removed upstream `oot.gousse.cool` host entry from `preview.allowedHosts` in `vite.config.ts`.

### Upstream Baseline (`lucasriondel/oot-remake-map`)
- Interactive Ocarina atlas (32 places, 184 official items), typed custom pins with near-pin merging, age filter, all-floors dungeon grid, per-map zoom/pan memory, offline PWA service worker, and Docker configuration.
