# Hyrule Atlas — Ocarina of Time Interactive Map & Lichii Live Tracker

An interactive Hyrule field atlas and dungeon floor tracker for *The Legend of Zelda: Ocarina of Time* Remake, featuring **real-time player tracking**, **automatic Gold Skulltula completion**, and a **Windows Plug & Play desktop launcher** built for the [Lichii](https://github.com/zortos293/Lichii) emulator.

Built on top of [`lucasriondel/oot-remake-map`](https://github.com/lucasriondel/oot-remake-map) (Field Atlas).

---

## Downloads & Releases

Download the latest portable Windows bundle from **[GitHub Releases](../../releases)**:

- **Asset:** `OcarinaMaps-Lichii-Windows-x64.zip`
- **Releases URL:** [`https://github.com/antonioalvromero/Hyrule-Atlas/releases`](https://github.com/antonioalvromero/Hyrule-Atlas/releases)

> **Platform Support Notice:**
> - **Windows 10 / 11 (x64) only** for the standalone `OcarinaMaps.exe` launcher and live Lichii emulator integration.
> - **Supported Game Build:** *The Legend of Zelda: Ocarina of Time* Remake (`0400486024DEC000`).
> - The standalone web map UI can also be run on Linux/macOS via Node.js or Docker without Windows emulator features.

---

## Key Features

### Live Lichii Emulator Integration
- **Real-Time Link Marker (`PlayerPin`):** Displays Link's live position, compass heading cone (`yaw`), current floor badge, and 3D `(X, Y, Z)` hover coordinates across the Hyrule World Map, individual zone/dungeon maps, and the All-Floors grid view.
- **ASLR- & Heap-Slide-Invariant Memory Reader:** Dynamically locates the Switch `MOD0` main NSO base and `.bss` singletons over Lichii's JSON-RPC debug server (`127.0.0.1:6545`), recovering cleanly across emulator restarts with sub-millisecond warm reads.
- **Automatic Gold Skulltula Tracking (`100 / 100`):** Reads active Skulltula actor flags (`masterTable` / `0xa3db7114`) and `PouchData.Item_Token_Gold.StockNum` in RAM by exact actor ID hash to mark, reveal, and reconcile Gold Skulltulas automatically (including unmarking Skulltulas when loading an earlier save) and display toast notifications.
- **Follow Link & Jump Controls:** Toggle **Follow Link** to switch routes and dungeon floors automatically as Link moves, or click **Go to Link** at any time.
- **Offline Save Fallback:** When Lichii's debug RPC (`:6545`) is closed, the bridge reads the newest local save slot (`caption.sav` / `progress.sav`) read-only and clearly indicates **Lichii · Save only** (`(Saved)`) so stale save pins are never confused with live RAM movement.

### Interactive Map & Progress Tracker
- **Complete Hyrule Atlas:** 32 places (20 overworld zones and 12 dungeons) and 184 official collectible items across 8 categories (100 Gold Skulltulas, Pieces of Heart, Heart Containers, Magic Beans, Great Fairies, Bottles, Keys, and Fairy Thoughts).
- **Custom Pins & Smart Merge:** Drop typed custom pins anywhere on a map; placing a pin near a matching official pin merges and reveals it automatically.
- **Age & Category Filtering:** Filter pins by **Child**, **Adult**, or **Both**, hide completed categories, inspect **All floors** side-by-side in dungeons, and save per-map zoom/pan state locally in browser `localStorage` (`oot-map:v1:*`).
- **Offline PWA Support:** Built with a service worker (`sw.js`) and web manifest so maps and visited item media cache locally.

### Portable Windows Launcher (`OcarinaMaps.exe`)
- **Zero Dependencies Required:** Includes an embedded portable `runtime/node.exe`, pre-bundled server (`app/standalone-server.mjs`), and compiled client/SSR assets (`app/dist/`). No separate Node.js or `npm` installation needed.
- **1-Click Lichii RPC Setup:** Detects and updates `%APPDATA%\lichii\nx2_switches.txt` to enable `EDEN_NX2_DEBUG_SERVER=127.0.0.1:6545`.
- **Clean Lifecycle Management:** Assigns the Node server to a Windows Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) so closing or crashing the launcher leaves zero orphan processes on port `3000`.

---

## Windows Quick Start (Plug & Play)

Follow these steps to run the tracker without installing Node.js or editing code:

1. **Download & Extract**
   - Download `OcarinaMaps-Lichii-Windows-x64.zip` from **[GitHub Releases](https://github.com/antonioalvromero/Hyrule-Atlas/releases)**.
   - Right-click the `.zip` file, choose **Extract All...**, and extract the `OcarinaMaps-Windows-x64` folder anywhere (for example, `Desktop` or `Documents`).

2. **Launch `OcarinaMaps.exe`**
   - Open the extracted `OcarinaMaps-Windows-x64` folder and double-click **`OcarinaMaps.exe`**.
   - *(If Windows SmartScreen shows "Windows protected your PC" for an unsigned open-source binary, click **More info** -> **Run anyway**.)*

3. **Enable Lichii Debug RPC (Port `6545`)**
   - **Recommended (1-Click Setup):** In the launcher under **Lichii Auto-Setup (`%APPDATA%\lichii\nx2_switches.txt`)**, click **Enable Lichii RPC (6545)**.
     - This automatically creates or updates `%APPDATA%\lichii\nx2_switches.txt` with `EDEN_NX2_DEBUG_SERVER=127.0.0.1:6545` while preserving all existing settings.
     - **If Lichii is already open, close and restart Lichii completely** so it loads the updated switch on startup.
   - **Manual Fallback (Alternative):**
     1. Press `Win + R`, paste `%APPDATA%\lichii`, and press **Enter** (create the `lichii` folder if it does not exist).
     2. Create or edit `nx2_switches.txt` in that folder and add this exact line:
        ```text
        EDEN_NX2_DEBUG_SERVER=127.0.0.1:6545
        ```
     3. Save the file and restart `lichii.exe`.
     - *(Note: `%APPDATA%\lichii\nx2_switches.txt` persists across Lichii updates and overrides the `nx2_switches.txt` next to `lichii.exe`. You can also launch `lichii.exe` with `EDEN_NX2_DEBUG_SERVER=127.0.0.1:6545` set as a Windows environment variable.)*

4. **Start the Map Server**
   - In `OcarinaMaps.exe`, click **Start Server**.
   - With **Auto-open browser when server starts** checked, your default browser opens `http://127.0.0.1:3000` automatically (or click **Open Map in Browser**).

5. **Play in Lichii**
   - Boot *Ocarina of Time* (`0400486024DEC000`) in Lichii and load a save slot.
   - Confirm the launcher reads **In-game live tracking** and the bottom-left map bar shows **Lichii · Live**.

### Understanding Connection States

| Map Tracker Status | Launcher RPC Status | Meaning |
| --- | --- | --- |
| **Lichii · Live** (pulsing green) | **In-game live tracking** | Connected to Lichii `:6545` and streaming live RAM coordinates, floor, and Gold Skulltula flags. |
| **Lichii · Waiting for game** (amber) | **Lichii RPC open (Waiting for game)** | Lichii `:6545` is open, but Link is not in an active gameplay scene yet (title/boot screen). Shows save fallback data if available. |
| **Lichii · Save only** (static amber) | **Port 6545 closed (Not detected)** | RPC `:6545` is unreachable; displaying the latest local `caption.sav` / `progress.sav` snapshot (`(Saved)`). Live movement and Auto-Skulltula are paused. |
| **Lichii · Disconnected** (muted) | **Port 6545 closed (Not detected)** | Neither Lichii RPC `:6545` nor a local save directory was found (or the local server stopped). Click **Retry** once ready. |

### Launcher Options & CLI Flags

- **GUI Controls:** `Port` (default `3000`), `Auto-open browser when server starts`, `Hide to tray on minimize`, collapsible `Lichii ▾` (`Lichii Host` / `Lichii RPC Port`), and collapsible `Show Log` / `Hide Log` (`Activity Log`).
- **Optional Command-Line Flags:**
  - `--port <number>` (or `--port=<number>`) — Override web UI port (`1..65535`)
  - `--lichii-host <host>` — Override Lichii RPC host
  - `--lichii-port <number>` — Override Lichii RPC port
  - `--no-browser` — Do not open a browser tab on startup
  - `--minimized` — Start minimized
  - `--auto-start` — Start the map server immediately on launch

---

## Configuration & Environment Variables

Both `scripts/server-entry.ts` and the Vite dev/preview server (`src/lib/lichii-server.ts`) support the following environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address for the standalone HTTP server (`scripts/server-entry.ts`). |
| `PORT` | `3000` | HTTP port for the standalone server (`0..65535`). |
| `APP_DIST_DIR` | Auto-resolved `dist` | Explicit path to the built `dist/` folder (`client/` + `server/`) when running `standalone-server.mjs`. |
| `LICHII_HOST` | `127.0.0.1` | Hostname or IP of the Lichii JSON-RPC debug server. |
| `LICHII_PORT` | `6545` | TCP port of the Lichii JSON-RPC debug server (`1..65535`). |
| `LICHII_SAVE_DIR` | `%APPDATA%\lichii\nand\user\save\0000000000000000` | Optional save folder override. Supports direct `slot_*`, title ID (`0400486024DEC000`), profile, or `nand/user/save` layouts. |

---

## Developer Setup

### Prerequisites
- **Node.js `22.12+` or `24.x`** (tested on Node `24.15.0`; required by Vite 8 and Vitest 5) and **npm** (or **Bun**, matching `bun.lock`)
- **Windows 10/11 x64** with **.NET Framework 4.x** (`%WINDIR%\Microsoft.NET\Framework64\v4*\csc.exe`, preinstalled on Windows) if building the `.exe` launcher

### Common Commands

```sh
# 1. Install dependencies (use `npm ci` when package-lock.json is present, or `bun install`)
npm install

# 2. Start Vite dev server with live /api/lichii/state middleware (http://localhost:3000)
npm run dev

# 3. Run TypeScript typechecking
npm run typecheck

# 4. Run unit tests (Vitest)
npm test

# 5. Build client + standalone SSR bundle (dist/)
npm run build

# 6. Preview the production Vite build
npm run start

# 7. Bundle the zero-node_modules standalone Node server (dist/standalone-server.mjs)
npm run server:build

# 8. Build the complete Windows portable folder + release ZIP (Windows only)
npm run build:win
```

`npm run build:win` stages the self-contained runtime in `release/OcarinaMaps-Windows-x64/` and packages `release/OcarinaMaps-Lichii-Windows-x64.zip`.

### Docker (Map Web App Only)

The repository retains the upstream [`Dockerfile`](Dockerfile) using Bun (`oven/bun:1.4`) to build and serve the map web app on port `3000` without Windows Lichii host integration.

---

## Architecture Overview

```text
+-----------------------------------+       +--------------------------------------+
|  Lichii Emulator (Windows x64)    |       |  Local Save Slots (Fallback)         |
|  TCP JSON-RPC :6545               |       |  %APPDATA%\lichii\...\0400486024DEC000|
|  (EDEN_NX2_DEBUG_SERVER)          |       |  slot_XX/{caption.sav, progress.sav} |
+-----------------+-----------------+       +------------------+-------------------+
                  |                                            |
                  +--------------------+-----------------------+
                                       v
+----------------------------------------------------------------------------------+
|  Telemetry Bridge (src/lib/lichii-server.ts)                                     |
|  - Discovers Switch MOD0 main_base -> .bss singletons -> Sub[36], GDM, flags     |
|  - Maps 32 scenes + floor Y thresholds + SVG viewBox projections                 |
|  - Resolves 100/100 Gold Skulltulas via actor hashes + token count               |
|  - Exposes GET /api/lichii/state (Vite middleware or scripts/server-entry.ts)    |
+--------------------------------------+-------------------------------------------+
                                       | HTTP JSON polling (150ms live / 750ms idle)
                                       v
+----------------------------------------------------------------------------------+
|  React / TanStack Start UI (src/lib/useLichiiTracker.ts + src/components/*)      |
|  - Renders WorldMap, PlaceView, FloorGrid, PlayerPin, and LichiiStatusPanel      |
|  - Reconciles collected Gold Skulltulas into browser localStorage (oot-map:v1:*) |
+----------------------------------------------------------------------------------+
                                       ^
                                       | Supervised via Windows Job Object
+----------------------------------------------------------------------------------+
|  Windows Launcher (launcher/OcarinaMaps.cs -> OcarinaMaps.exe)                   |
|  - Starts/stops runtime/node.exe + app/standalone-server.mjs (or repo dev/dist)  |
|  - Polls /api/lichii/state & TCP :6545; configures nx2_switches.txt in 1 click   |
+----------------------------------------------------------------------------------+
```

---

## Project Layout

| Path | Purpose |
| --- | --- |
| `src/routes/` | TanStack Start routes (`__root.tsx`, `index.tsx` world map, `$zone.tsx` place view). |
| `src/components/` | Map viewport, world/place views, floor grid, pin controls, `PlayerPin.tsx`, and `LichiiStatusPanel.tsx`. |
| `src/lib/` | Dataset helpers (`data.ts`), projection math (`coords.ts`), pin merging (`merge.ts`), `localStorage` persistence (`storage.ts`), Lichii telemetry bridge (`lichii-server.ts`, `lichii-types.ts`), client polling (`useLichiiTracker.ts`), and `*.test.ts` Vitest suites. |
| `src/data/oot.json` | Atlas dataset (32 places, 184 official items, categories, requirements). |
| `public/` | Static map SVGs/WebPs (`content/maps/`), item screenshots (`content/media/`), PWA icons, and `manifest.webmanifest`. |
| `pwa/` | Build-time service worker generator (`plugin.ts`) and offline cache template (`sw.js`). |
| `launcher/` | Native C# WinForms Windows launcher source (`OcarinaMaps.cs`). |
| `scripts/` | Standalone production Node HTTP server (`server-entry.ts`), Windows portable packager (`build-win.mjs`), smoke test (`smoke-test-win.ps1`), and AI release notes composer (`generate-release-notes.mjs`). |
| `.github/` | Issue templates, PR template, release category/AI guidelines (`release.yml`, `release-notes-instructions.md`), CI workflow (`ci.yml`), and Windows release workflow (`release-windows.yml`). |
| `AGENTS.md` | Architecture notes, engineering invariants, and verification commands for AI coding agents. |
| `LICENSE` | MIT License covering newly authored **Hyrule Atlas** components and documentation. |

---

## Credits & Attribution

- **Original Map Tracker:** Built upon [`lucasriondel/oot-remake-map`](https://github.com/lucasriondel/oot-remake-map) (Field Atlas).
- **Emulator Integration:** Designed for [`zortos293/Lichii`](https://github.com/zortos293/Lichii).
- **Documentation Co-Author:** This `README.md` and repository documentation were co-authored with **Antigravity AI** (Google DeepMind).
- **Map Assets & Item Data:** Map images and location data come from [Nintendúo](https://nintenduo.com/juegos/the-legend-of-zelda-ocarina-of-time/mapa/en/). The content belongs to its owner and is used without their permission.
- **Disclaimer:** Non-commercial fan project, not affiliated with Nintendo.

---

## License

Newly authored **Hyrule Atlas** components — including the live Lichii telemetry bridge (`src/lib/lichii-*`, `src/lib/useLichiiTracker.ts`, `src/components/LichiiStatusPanel.tsx`, `src/components/PlayerPin.tsx`), Windows launcher (`launcher/`), build and release automation scripts (`scripts/`, `.github/`), and documentation — are licensed under the **[MIT License](LICENSE)** (permissive free use, modification, and distribution).

The upstream repository ([`lucasriondel/oot-remake-map`](https://github.com/lucasriondel/oot-remake-map)) does **not** include a `LICENSE` file in its root directory; upstream base code remains subject to its upstream terms, and map assets/game IP remain the property of their respective owners as noted in **Credits & Attribution**.
