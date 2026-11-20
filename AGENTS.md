# AGENTS.md

This file provides repository-specific guidance, architecture notes, and verification requirements for AI coding agents working on **Ocarina Atlas** (live Lichii telemetry + Windows launcher extension of `lucasriondel/oot-remake-map`).

## Project Overview

- **Target platform:** Windows 10/11 (x64) for live emulator/recomp telemetry and the standalone desktop launcher (`OcarinaAtlas.exe`), plus experimental Linux x64 support (`OcarinaAtlas-Linux-x64.AppImage` Electron GUI + `longshot-rpc-bridge`). The web UI renders on any OS with Node.js `22.12+` / `24.x`.
- **Target game build:** *The Legend of Zelda: Ocarina of Time* Remake (`0400486024DEC000`) running on [Lichii](https://github.com/zortos293/Lichii), Fritchii, CheezyEmu (`cheezyemu.exe`), [Longshot](https://git.magicbean.dev/MagicBeanDev/Longshot) (`longshot.exe` / `hookshot.exe`), [Project ReLink](https://github.com/pixl27/ProjectReLink) (`relink-game.exe` / `relink.exe`), Triforce (`Triforce.exe`), [HeyListen](https://github.com/Sacrappy/HeyListen) (`HeyListen.exe` / `heylisten`), NX2Saria (`ocarina` / `nx2saria`, native `:6545` RPC), or NovaOOT / OOT-PC & NX2navi (`ocarina` / `nx2navi`, direct host VA bridge).
- **Stack:** React 19, TanStack Start / TanStack Router, Tailwind CSS v4, Vite 8, Vitest 5, TypeScript 7 (`strict`), Node.js HTTP server (`scripts/server-entry.ts`), `.NET Framework 4.x` WinForms (`launcher/OcarinaAtlas.cs`), and Electron AppImage + C99 POSIX bridge (`launcher/linux-appimage/*`, `launcher/linux/longshot_rpc_bridge.c`).

## Essential Commands

Run commands from the repository root:

```sh
npm run dev           # Vite dev server at http://localhost:3000 with /api/lichii/state middleware
npm run typecheck     # tsc --noEmit
npm test              # vitest run (all unit test suites in src/**/*.test.ts)
npm run build         # Vite client + standalone SSR bundle (dist/)
npm run server:build  # Vite build + Rolldown standalone server bundle (dist/standalone-server.mjs)
npm run build:win     # Complete Windows portable bundle + release/OcarinaAtlas-Windows-x64.zip
npm run build:linux   # Complete Linux x64 AppImage + release/OcarinaAtlas-Linux-x64.AppImage (experimental)
```

Notes for Windows shells:
- PowerShell 5.1 does not support `&&`; use `;` or check `$LASTEXITCODE`.
- Do not commit artifacts ignored by `.gitignore` (`dist/`, `release/`, `dist-win/`, `*.exe`, `*.zip`, `node_modules/`).

## Repository Map & Ownership Boundaries

- `src/lib/lichii-types.ts` — Shared TypeScript contract (`LichiiTelemetryState`) between backend telemetry and React clients.
- `src/lib/lichii-server.ts` — Node-only server module:
  - `LichiiRpcClient` over persistent TCP (`LICHII_HOST` default `127.0.0.1`, `LICHII_PORT` default `6545`).
  - Dynamic Switch NSO `MOD0` base discovery (`ensureMainBase`, `validateMainBaseHeader`), ASLR-adjusted vtable calculation (`deriveDynamicVtables`), and guest heap pointer floor `MIN_GUEST_HEAP_PTR` (`0x1000000000n`, supporting both Longshot's `HOS_HEAP_BASE = 0x1000000000` and Lichii/Fritchii/Eden `0x2000000000+`; `0x100000000n` while the RPC status reports `nx2saria`, via `getMinGuestHeapPtr`).
  - Zero-scan `.bss` singleton dereferencing (`resolvePlayerFromBss`, `resolveGameDataMgr`, `resolveGdmStockAddrFromContainer`, `resolveMasterTableMetaFromGdm`) with heap scan fallbacks (`resolvePlayerViaHeapFallbacks`).
  - Authoritative 184/184 collectibles parsing: 100 Gold Skulltulas (`parseMasterFlagTableChunks`, `KNOWN_SKULLTULA_HASH_MAP`), plus `GameDataMgr + 0x170` (`gdmBoolVt`, `KNOWN_HEART_PIECE_HASH_MAP`, `KNOWN_HEART_PIECE_BOOL_HASH_MAP`, `KNOWN_BEAN_BOOL_HASH_MAP`, `KNOWN_FAIRY_BOOL_HASH_MAP`, `KNOWN_BOTTLE_BOOL_HASH_MAP`, `KNOWN_THOUGHT_BOOL_HASH_MAP` including `IsTreasureBoxOpen.*` and `HaveReadHrlField_Note12_1..3`) and `GameDataMgr + 0x230` (`gdmStockVt`, `GHOST_SHOP_COUPON_NUM_HASH`), with precomputed contiguous chunk windows (`buildGdmBoolWindows`), live/save `ownedRequirements` extraction, and `SaveBuf` / `progress.sav` fallback.
  - Read-only local save slot parser (`findLatestSaveSlotDir`, `LICHII_SAVE_DIR`, `CHEEZYEMU_SAVE_DIR`, `LONGSHOT_SAVE_DIR`, `RELINK_SAVE_DIR`, `TRIFORCE_SAVE_DIR`, `NX2SARIA_SAVE_DIR`, `$XDG_DATA_HOME/{fritchii,lichii,eden,cheezyemu}/nand/user/save/0000000000000000`, `<user>/save/<uid>/slot_*`, `caption.sav` / `progress.sav`).
  - `lichiiTelemetryPlugin()` for Vite dev/preview `/api/lichii/state` and shared `120 ms` SSE broadcaster (`handleLichiiStreamRequest`).
- `src/lib/useLichiiTracker.ts` — Client SSE + polling fallback store (`150 ms` live / `750 ms` idle), split `useLichiiPosition()` / `subscribeLichiiPosition` fast-path vs `useLichiiTracker({ trackPosition: false })`, `isLiveMemoryState()`, `canSyncTelemetryProgress()` (enabling 184/184 map/Stats/`ownedRequirements` sync in both live and `source === 'save'` modes without live toasts/Camera Follow in save-only mode), `reconcileSkulltulaLists()` / `processTrackedCategory()` across all 7 collectible categories, optional gear `ownedRequirements` auto-sync, and toast state synced to `localStorage` (`oot-map:v1:*`).
- `src/lib/data.ts`, `src/lib/i18n.ts` & `src/lib/prerequisites.ts` — Dataset loader (`src/data/oot.json`), 15-language localization (`en`, `es`, `fr`, `pt`, `zh-CN`, `zh-TW`, `de`, `it`, `ja`, `ko`, `nl`, `ru`, `pl`, `tr`, `uk`), category/requirement helpers, `formatFloorLabel()`, and the 33-item gear prerequisite evaluator (`REQUIREMENT_GROUPS`, `expandOwnedRequirements`, ignoring `day`/`night`).
- `src/components/` — `MapViewport.tsx` (persistent zoom via `zoomSlot` + Camera Follow `panToFraction`), `WorldMap.tsx`, `PlaceView.tsx`, `FloorGrid.tsx`, `GlobalStatsDrawer.tsx` (interactive category cards, **Hide completed** & **Show official pins**, direct jump), `GearChecklistModal.tsx` (`My Gear` / `Only reachable`), `CreditsModal.tsx` (GNU AGPL-3.0 & attribution), `PlayerPin.tsx`, and `LichiiStatusPanel.tsx` (`Auto Tracking`, Save Slot selector, Dynamic Island quick-toggle pills).
- `src/lib/server-network.ts` — Pure LAN/host utilities (`parseServerConfig`, `collectLanIpv4Urls`, `sanitizeHostHeader`, `resolveAllowedDevHosts`) shared across `scripts/server-entry.ts` and `vite.config.ts`.
- `scripts/server-entry.ts` — Zero-`node_modules` standalone Node HTTP server serving `/api/lichii/stream`, `/api/lichii/state`, `/api/saves/slot`, `/api/sync`, weak-`ETag`/`304` static files from `dist/client/`, and SSR via `dist/server/server.js` (defaulting to `0.0.0.0` for LAN second-screen access, with `--local-only` / `HOST=127.0.0.1` override and `--save-dir` / `--save-slot` support).
- `launcher/OcarinaAtlas.cs` — Native C# WinForms launcher (`OcarinaAtlas.exe`) with Fritchii-inspired Hyrule dark UI (`DWMWA_USE_IMMERSIVE_DARK_MODE`, `Theme.Gold` accents, 3-zone layout, QR modal, `Settings` | `Logs` | `About` drawer, persistent Save Folder manager & Save Slot selector, 15-language UI, PE assembly metadata, Markdown `UpdateDialog` enforcing official GitHub hosts, `.sha256` archive verification, and `prerelease`/`draft` rejection), compiled by `%WINDIR%\Microsoft.NET\Framework64\v4*\csc.exe` (`/target:winexe /platform:x64 /warn:4 /warnaserror`), managing the server child process with a Windows Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`), auto-starting a read-only `LongshotRpcBridge` (`OpenProcess(0x0410)` + `VirtualQueryEx` + `ReadProcessMemory` on `GuestWindowBase = 0x100000000000UL`, or direct host VA `GuestWindowBase = 0` for `OOT-PC` / `NX2navi`) on `127.0.0.1:{lichiiPort}` when `longshot.exe`/`hookshot.exe`/`relink-game.exe`/`relink.exe`/`Triforce.exe`/`HeyListen.exe`/`ocarina.exe`/`nx2navi.exe` is running, LAN URL discovery/copying (`LanNetworkHelper`), explicit Private-profile Windows Firewall setup (`--lan` / `--local-only` / `--host`), and 1-click `%APPDATA%\lichii\nx2_switches.txt` / `%APPDATA%\fritchii\nx2_switches.txt` / `%APPDATA%\cheezyemu\nx2_switches.txt` configuration.
- `scripts/build-win.mjs` — Cross-platform Node script orchestrating `vite build`, `rolldown`, copying `node.exe`, compiling `launcher/OcarinaAtlas.cs`, and producing `release/OcarinaAtlas-Windows-x64.zip`.
- `scripts/smoke-test-win.ps1` — PowerShell verification script asserting Windows release artifacts, launching `OcarinaAtlas.exe` outside the repo, validating HTTP `200` on `/` and `/api/lichii/state`, and confirming Job Object port cleanup.
- `launcher/linux-appimage/`, `launcher/linux/longshot_rpc_bridge.c` & `scripts/build-linux.mjs` / `scripts/smoke-test-linux.sh` — Experimental Linux x64 AppImage (`release/OcarinaAtlas-Linux-x64.AppImage`): Electron desktop GUI (`main.cjs`, `preload.cjs`, `index.html`, supporting `--cli`, `--setup-sync`, `--lan`, `--local-only`, `--port`, `--no-browser`, `--save-dir`, `--save-slot`, 15 languages, and persistent `~/.config/ocarina-atlas/settings.json`) and read-only C99 bridge (`longshot_rpc_bridge.c` -> `longshot-rpc-bridge`) using `process_vm_readv()` / `O_RDONLY` `/proc/<pid>/mem` (subject to `kernel.yama.ptrace_scope` on Linux) for native and Wine/Proton recomps.
- `src/lib/release-notes.ts` & `scripts/generate-release-notes.mjs` — Pure prompt/summary helpers and CI release-body composer supporting `COPILOT_GITHUB_TOKEN`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, Windows + Linux SHA-256 checksums, and `CHANGELOG.md` fallback.
- `.github/workflows/` — CI (`ci.yml`, including `verify`, `build-windows`, `build-linux`, and `ci-gate`) and dual-platform release packager (`release-windows.yml`, packaging Windows `.zip` + Linux `.AppImage` with `.sha256` sidecars, `actions/attest-build-provenance`, and pre-release shielding).
- `LICENSE` — Newly authored Ocarina Atlas components are licensed under GNU AGPL-3.0.

## Critical Engineering Invariants

1. **English-only UI and standard floor notation:** Keep all default UI copy, accessibility labels, tooltips, error messages, and code comments in English (localized strings live in `src/lib/i18n.ts` and `src/data/i18n/*.json`). `formatFloorLabel()` must preserve `1F`–`5F` and map basements `S1`–`S4` to `B1`–`B4`, `nino` to `Child`, `adulto` to `Adult`, and `principal` to `Main`.
2. **Never confuse disk saves with live RPC connectivity:** `deriveConnectionStatus()` must set `connected: false` and `emulatorRunning: false` when TCP RPC is disconnected, even when `source === 'save'` provides offline save metadata. Only `isLiveMemoryState()` (`connected && emulatorRunning && source === 'memory'`) may trigger fast live streaming/polling, animated green live UI, `followPlayer` navigation / Camera Follow, or live pickup toasts (while `canSyncTelemetryProgress()` allows authoritative 184/184 map/Stats/`ownedRequirements` sync in `source === 'save'` mode).
3. **Never reintroduce proximity collectible guessing:** Collectible completion (184/184 across all 7 categories) must come strictly from exact actor ID hashes / `GameDataMgr` / `SaveBuf` / `progress.sav` hashes (`KNOWN_*_HASH_MAP`, `parseMasterFlagTableChunks`, `0xa3db7114`). When an `authoritative*` flag is `true`, `reconcileSkulltulaLists()` must unmark and un-reveal IDs in that category absent from the currently loaded save while preserving other categories and manually revealed uncollected pins.
4. **ASLR safety across emulator restarts:** Do not hardcode session heap or vtable addresses as primary lookup keys. Always derive dynamic vtables from the validated NSO `MOD0` base and clear all cached pointers in `resetLiveSessionCaches()` on RPC disconnect or session restart.
5. **Read-only guarantee & legal hygiene:** Never write to emulator/game memory (`write_memory`, `WriteProcessMemory`, and `process_vm_writev` are off-limits; `LongshotRpcBridge` must only request `PROCESS_VM_READ | PROCESS_QUERY_INFORMATION`, and Linux `longshot-rpc-bridge` must only use `process_vm_readv` / `O_RDONLY` `/proc/<pid>/mem`) or mutate `.sav` files. Launcher `nx2_switches.txt` writes (on Windows or `OcarinaAtlas-Linux-x64.AppImage --setup-sync`) and Windows Defender Firewall rule creation (`profile=private`) must happen only on explicit user action, preserving unrelated switches/rules. Never commit ROMs, decryption keys, NAND dumps, `.sav` files, or memory dumps.
6. **Zero runtime `node_modules` in portable releases:** Any imports added to `src/lib/lichii-server.ts`, `scripts/server-entry.ts`, or TanStack Start SSR routes must bundle cleanly with `vite.config.ts` (`standaloneSsrPlugin` with `noExternal: true`) and Rolldown so `release/OcarinaAtlas-Windows-x64/` and `release/OcarinaAtlas-Linux-x64.AppImage` execute using only their bundled Node.js / Electron runtime.

## Verification Checklist

Before finishing any change:
1. Run `npm run typecheck` (must exit `0`).
2. Run `npm test` (all Vitest test suites must pass without skipped or weakened assertions).
3. If modifying `src/lib/lichii-server.ts`, `scripts/server-entry.ts`, `scripts/build-win.mjs`, `launcher/OcarinaAtlas.cs`, `vite.config.ts`, or frontend bundles included in Windows releases:
   - Run `npm run build:win` and verify `release/OcarinaAtlas-Windows-x64.zip` is created cleanly.
   - Smoke-test the extracted release outside the repo (`OcarinaAtlas.exe --port <free-port> --no-browser --auto-start --minimized`) when modifying runtime or launcher lifecycle code.
