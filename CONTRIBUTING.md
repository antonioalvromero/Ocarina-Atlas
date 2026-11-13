# Contributing to Ocarina Atlas

Thank you for your interest in contributing to **Ocarina Atlas** (the live Lichii emulator integration and Windows launcher extension of [`lucasriondel/oot-remake-map`](https://github.com/lucasriondel/oot-remake-map)).

> AI coding assistants: review [`AGENTS.md`](AGENTS.md) before editing code or build scripts.

## Code of Conduct

Please review and follow our [Code of Conduct](CODE_OF_CONDUCT.md) in all repository interactions.

## Prerequisites

- **Node.js `22.12+` or `24.x`** (Vite 8 and Vitest 5 require `^22.12.0 || >=24.0.0`)
- **npm** (or **Bun**, matching `bun.lock`)
- **Windows 10 / 11 (x64)** with **.NET Framework 4.x** (`csc.exe`, preinstalled under `%WINDIR%\Microsoft.NET\Framework64\v4*`) if modifying or testing `launcher/OcarinaAtlas.cs` or `scripts/build-win.mjs`
- **Optional for live telemetry testing:** [Lichii](https://github.com/zortos293/Lichii) emulator running *The Legend of Zelda: Ocarina of Time* Remake (`0400486024DEC000`) with `EDEN_NX2_DEBUG_SERVER=127.0.0.1:6545`

## Setting Up Locally

```sh
git clone https://github.com/antonioalvromero/Ocarina-Atlas.git
cd Ocarina-Atlas
npm install   # or `npm ci` when package-lock.json is present, or `bun install`
npm run dev
```

Open `http://localhost:3000`. The telemetry endpoint is available at `GET /api/lichii/state`.

## Available Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start Vite dev server with live `/api/lichii/state` telemetry |
| `npm run typecheck` | Run TypeScript typechecking (`tsc --noEmit`) |
| `npm test` | Run Vitest unit tests (`src/**/*.test.ts`) |
| `npm run build` | Build client assets and standalone SSR output (`dist/`) |
| `npm run start` | Preview production Vite build |
| `npm run server:build` | Bundle standalone server (`dist/standalone-server.mjs`) via Rolldown |
| `npm run build:win` | Build portable Windows bundle (`release/OcarinaAtlas-Windows-x64/`) and ZIP (`release/OcarinaAtlas-Windows-x64.zip`) |

## Project Conventions

1. **Language & Copy:** Keep all UI strings, error messages, code comments, and documentation in clear English.
2. **Type Safety & Tests:**
   - Ensure `npm run typecheck` exits with `0` errors.
   - Add or update unit tests in `src/**/*.test.ts` (for example, `src/lib/lichii-server.test.ts` for pure telemetry, save-parsing, projection, and config helpers).
   - Keep pure parsing/validation helpers exported separately from side-effectful socket or file I/O when adding telemetry features.
3. **Launcher & Packaging Changes:**
   - `launcher/OcarinaAtlas.cs` targets `.NET Framework 4.x` `csc.exe` with `/warn:4 /warnaserror` and zero external NuGet packages.
   - When modifying `scripts/server-entry.ts` or `scripts/build-win.mjs`, verify `npm run build:win` succeeds on Windows and test the extracted `release/OcarinaAtlas-Windows-x64/OcarinaAtlas.exe` outside the repository (without `node_modules`).
4. **Legal & Privacy Hygiene:**
   - Never commit copyrighted game ROMs, decryption keys, NAND dumps, personal save files (`*.sav`), or raw memory dumps.
   - Preserve existing attributions to [`lucasriondel/oot-remake-map`](https://github.com/lucasriondel/oot-remake-map), [Nintendúo](https://nintenduo.com/juegos/the-legend-of-zelda-ocarina-of-time/mapa/en/), and [`zortos293/Lichii`](https://github.com/zortos293/Lichii).

## Pull Request Process

1. Create a focused branch from `main` (for example, `feat/dungeon-floor-offset` or `fix/launcher-tray`).
2. Make your changes and run:
   ```sh
   npm run typecheck
   npm test
   npm run build
   ```
   On Windows, also run `npm run build:win` and `.\scripts\smoke-test-win.ps1` if you touched `launcher/`, `scripts/`, `vite.config.ts`, or `src/lib/lichii-server.ts`.
3. Open a pull request against `main` using [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) and describe how you verified your changes. All automated checks (`CI Gate`, Linux Node 22/24 tests + builds, and Windows portable build + smoke test) must succeed in CI.
