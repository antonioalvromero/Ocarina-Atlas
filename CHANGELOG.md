# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Project Logo & Windows Icon (`assets/logo.png`, `launcher/OcarinaAtlas.ico`):** Added official Ocarina Atlas branding assets for the repository README and Windows launcher executable.

### Changed
- **Client, Server & Vite Optimizations (`src/lib/lichii-server.ts`, `src/lib/useLichiiTracker.ts`, `vite.config.ts`):** Improved telemetry polling, server/build performance, and Vite integration.
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
