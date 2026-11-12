# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
  - Rewrote `README.md` with Plug & Play Windows guide, developer docs, architecture overview, and upstream attributions for **Hyrule Atlas**.
  - Added `AGENTS.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, GitHub issue/PR templates, and GitHub Actions CI (`ci.yml`) and Windows release (`release-windows.yml`) workflows.

### Changed
- Standardized all tracker UI strings, status badges, and floor labels (`1F`–`5F`, `B1`–`B4`, `Child`, `Adult`, `Main`) into English across `src/lib/data.ts`, `src/components/LichiiStatusPanel.tsx`, `src/components/PlayerPin.tsx`, and `src/components/PlaceView.tsx`.
- Removed upstream `oot.gousse.cool` host entry from `preview.allowedHosts` in `vite.config.ts`.

### Upstream Baseline (`lucasriondel/oot-remake-map`)
- Interactive Hyrule atlas (32 places, 184 official items), typed custom pins with near-pin merging, age filter, all-floors dungeon grid, per-map zoom/pan memory, offline PWA service worker, and Docker configuration.
