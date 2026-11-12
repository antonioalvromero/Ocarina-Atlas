# AGENTS.md

This file provides repository-specific guidance, architecture notes, and verification requirements for AI coding agents working on **Hyrule Atlas** (live Lichii telemetry + Windows launcher extension of `lucasriondel/oot-remake-map`).

## Project Overview

- **Target platform:** Windows 10/11 (x64) for live emulator telemetry and the standalone desktop launcher (`OcarinaMaps.exe`). The web UI renders on any OS with Node.js `22.12+` / `24.x`.
- **Target game build:** *The Legend of Zelda: Ocarina of Time* Remake (`0400486024DEC000`) running on [Lichii](https://github.com/zortos293/Lichii).
- **Stack:** React 19, TanStack Start / TanStack Router, Tailwind CSS v4, Vite 8, Vitest 5, TypeScript 7 (`strict`), Node.js HTTP server (`scripts/server-entry.ts`), and `.NET Framework 4.x` WinForms (`launcher/OcarinaMaps.cs`).

## Essential Commands

Run commands from the repository root:

```sh
npm run dev           # Vite dev server at http://localhost:3000 with /api/lichii/state middleware
npm run typecheck     # tsc --noEmit
npm test              # vitest run (all unit test suites in src/**/*.test.ts)
npm run build         # Vite client + standalone SSR bundle (dist/)
npm run server:build  # Vite build + Rolldown standalone server bundle (dist/standalone-server.mjs)
npm run build:win     # Complete Windows portable bundle + release/OcarinaMaps-Lichii-Windows-x64.zip
```

Notes for Windows shells:
- PowerShell 5.1 does not support `&&`; use `;` or check `$LASTEXITCODE`.
- Do not commit artifacts ignored by `.gitignore` (`dist/`, `release/`, `dist-win/`, `*.exe`, `*.zip`, `node_modules/`).

## Repository Map & Ownership Boundaries

- `src/lib/lichii-types.ts` — Shared TypeScript contract (`LichiiTelemetryState`) between backend telemetry and React clients.
- `src/lib/lichii-server.ts` — Node-only server module:
  - `LichiiRpcClient` over persistent TCP (`LICHII_HOST` default `127.0.0.1`, `LICHII_PORT` default `6545`).
  - Dynamic Switch NSO `MOD0` base discovery (`ensureMainBase`, `validateMainBaseHeader`) and ASLR-adjusted vtable calculation (`deriveDynamicVtables`).
  - Zero-scan `.bss` singleton dereferencing (`resolvePlayerFromBss`, `resolveGameDataMgr`, `resolveGdmStockAddrFromContainer`, `resolveMasterTableMetaFromGdm`) with heap scan fallbacks (`resolvePlayerViaHeapFallbacks`).
  - Authoritative 100 Gold Skulltula flag table parsing (`parseMasterFlagTableBuffer`, `KNOWN_SKULLTULA_HASH_MAP`).
  - Read-only local save slot parser (`findLatestSaveSlotDir`, `LICHII_SAVE_DIR`, `caption.sav` / `progress.sav`).
  - `lichiiTelemetryPlugin()` for Vite dev/preview `/api/lichii/state`.
- `src/lib/useLichiiTracker.ts` — Client polling store (`150 ms` live / `750 ms` idle), `isLiveMemoryState()`, `reconcileSkulltulaLists()`, and toast state synced to `localStorage` (`oot-map:v1:*`).
- `src/lib/data.ts` — Dataset loader (`src/data/oot.json`), category/requirement helpers, and `formatFloorLabel()`.
- `src/components/` — `WorldMap.tsx`, `PlaceView.tsx`, `FloorGrid.tsx`, `PlayerPin.tsx`, `LichiiStatusPanel.tsx`.
- `src/lib/server-network.ts` — Pure LAN/host utilities (`parseServerConfig`, `collectLanIpv4Urls`, `sanitizeHostHeader`, `resolveAllowedDevHosts`) shared across `scripts/server-entry.ts` and `vite.config.ts`.
- `scripts/server-entry.ts` — Zero-`node_modules` standalone Node HTTP server serving `/api/lichii/state`, static files from `dist/client/`, and SSR via `dist/server/server.js` (defaulting to `0.0.0.0` for LAN second-screen access, with `--local-only` / `HOST=127.0.0.1` override).
- `launcher/OcarinaMaps.cs` — Native C# WinForms launcher (`OcarinaMaps.exe`) compiled by `%WINDIR%\Microsoft.NET\Framework64\v4*\csc.exe` (`/target:winexe /platform:x64 /warn:4 /warnaserror`), managing the server child process with a Windows Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`), LAN URL discovery/copying (`LanNetworkHelper`), explicit Private-profile Windows Firewall setup (`--lan` / `--local-only` / `--host`), and 1-click `%APPDATA%\lichii\nx2_switches.txt` configuration.
- `scripts/build-win.mjs` — Cross-platform Node script orchestrating `vite build`, `rolldown`, copying `node.exe`, compiling `launcher/OcarinaMaps.cs`, and producing `release/OcarinaMaps-Lichii-Windows-x64.zip`.
- `scripts/smoke-test-win.ps1` — PowerShell verification script asserting Windows release artifacts, launching `OcarinaMaps.exe` outside the repo, validating HTTP `200` on `/` and `/api/lichii/state`, and confirming Job Object port cleanup.
- `src/lib/release-notes.ts` & `scripts/generate-release-notes.mjs` — Pure prompt/summary helpers and CI release-body composer supporting `COPILOT_GITHUB_TOKEN`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, SHA-256 digests, and `CHANGELOG.md` fallback.
- `.github/workflows/` — CI (`ci.yml`) and Windows release packager (`release-windows.yml`).

## Critical Engineering Invariants

1. **English-only UI and standard floor notation:** Keep all UI copy, accessibility labels, tooltips, error messages, and code comments in English. `formatFloorLabel()` must preserve `1F`–`5F` and map basements `S1`–`S4` to `B1`–`B4`, `nino` to `Child`, `adulto` to `Adult`, and `principal` to `Main`.
2. **Never confuse disk saves with live RPC connectivity:** `deriveConnectionStatus()` must set `connected: false` and `emulatorRunning: false` when TCP RPC is disconnected, even when `source === 'save'` provides offline save metadata. Only `isLiveMemoryState()` (`connected && emulatorRunning && source === 'memory'`) may trigger fast polling (`150 ms`), animated green live UI, `followPlayer` navigation, or Skulltula auto-marking.
3. **Never reintroduce proximity Skulltula guessing:** Gold Skulltula completion must come strictly from exact actor ID hashes (`KNOWN_SKULLTULA_HASH_MAP`, `parseMasterFlagTableBuffer`, or saved `0xa3db7114` hashes). When `authoritativeSkulltulas` is `true`, `reconcileSkulltulaLists()` must unmark and un-reveal GS IDs absent from the currently loaded save while preserving non-GS items and manually revealed uncollected pins.
4. **ASLR safety across emulator restarts:** Do not hardcode session heap or vtable addresses as primary lookup keys. Always derive dynamic vtables from the validated NSO `MOD0` base and clear all cached pointers in `resetLiveSessionCaches()` on RPC disconnect or session restart.
5. **Read-only guarantee & legal hygiene:** Never write to emulator memory (`write_memory` is off-limits) or mutate `.sav` files. Launcher `%APPDATA%\lichii\nx2_switches.txt` writes and Windows Defender Firewall rule creation (`profile=private`) must happen only on explicit user action, preserving unrelated switches/rules. Never commit ROMs, decryption keys, NAND dumps, `.sav` files, or memory dumps.
6. **Zero runtime `node_modules` in Windows releases:** Any imports added to `src/lib/lichii-server.ts`, `scripts/server-entry.ts`, or TanStack Start SSR routes must bundle cleanly with `vite.config.ts` (`standaloneSsrPlugin` with `noExternal: true`) and Rolldown so `release/OcarinaMaps-Windows-x64/` executes using only `runtime/node.exe`.

## Verification Checklist

Before finishing any change:
1. Run `npm run typecheck` (must exit `0`).
2. Run `npm test` (all Vitest test suites must pass without skipped or weakened assertions).
3. If modifying `src/lib/lichii-server.ts`, `scripts/server-entry.ts`, `scripts/build-win.mjs`, `launcher/OcarinaMaps.cs`, `vite.config.ts`, or frontend bundles included in Windows releases:
   - Run `npm run build:win` and verify `release/OcarinaMaps-Lichii-Windows-x64.zip` is created cleanly.
   - Smoke-test the extracted release outside the repo (`OcarinaMaps.exe --port <free-port> --no-browser --auto-start --minimized`) when modifying runtime or launcher lifecycle code.
