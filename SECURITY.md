# Security Policy

## Supported Platforms and Versions

Live emulator/recomp telemetry and the portable desktop launcher are fully supported on **Windows 10/11 (x64)** (`OcarinaAtlas.exe`), with experimental support on **Linux (x64)** (`OcarinaAtlas-Linux-x64.AppImage`). The web map interface runs in standard modern browsers on any OS when served via Node.js `22.12+` / `24.x` or the `node:24-slim` Docker image.

| Component / Version | Supported | Notes |
| --- | --- | --- |
| Latest `main` / current Windows release (`OcarinaAtlas-Windows-x64.zip`) | Yes | Windows 10/11 x64 (`0400486024DEC000` build) |
| Latest `main` / current Linux release (`OcarinaAtlas-Linux-x64.AppImage`) | Experimental | Linux x64 Electron AppImage + read-only `longshot-rpc-bridge` |
| Older snapshots / unmaintained forks | No | Please upgrade before reporting issues |

## Security and Privacy Design

This project is designed to operate locally on the user's machine with strict read-only telemetry and explicit opt-in network exposure:

- **Loopback RPC & opt-out LAN second-screen hardening**:
  - Live debug RPC (`Lichii`, `Fritchii`, `CheezyEmu`, `NX2Saria`, and the bundled read-only `LongshotRpcBridge` / `longshot-rpc-bridge`) binds and connects strictly over local loopback (`127.0.0.1:6545` by default via `LICHII_HOST` / `LICHII_PORT`).
  - To support opening the map from an iPad, tablet, or second PC on your home Wi-Fi/LAN out of the box, the map HTTP server defaults to `0.0.0.0` (`HOST` / `--lan`). You can restrict the web UI strictly to `127.0.0.1` at any time by unchecking **Allow LAN access** in the launcher **Settings** tab, passing `--local-only`, or setting `HOST=127.0.0.1`.
  - Standalone HTTP requests validate incoming `Host` headers via `sanitizeHostHeader()` before URL construction, and Vite dev/preview servers restrict hostnames via `resolveAllowedDevHosts()`.
- **Scoped Windows Firewall helper (explicit user action only)**: Clicking **Allow LAN Access** in `OcarinaAtlas.exe` runs `netsh advfirewall firewall add rule` via UAC elevation only on explicit click, scoped strictly to `profile=private` networks (`Ocarina Atlas (TCP <port>)`), never `public` or `any`.
- **Read-only emulator, recomp & save inspection**:
  - **Emulators & native RPC (`Lichii`, `Fritchii`, `CheezyEmu`, `NX2Saria`):** Uses read-only debug RPC (`status`, `read_memory`, `search_memory`). Never calls `write_memory`.
  - **Windows native recomp bridge (`LongshotRpcBridge` in `OcarinaAtlas.exe`):** Opens supported recomp processes (`longshot.exe`, `hookshot.exe`, `relink-game.exe`, `relink.exe`, `Triforce.exe`, `HeyListen.exe`, `ocarina.exe`, `nx2navi.exe`) strictly read-only with `OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION)` (`0x0410`) and reads memory via `VirtualQueryEx` + `ReadProcessMemory`. `WriteProcessMemory` is never used.
  - **Linux native & Wine/Proton recomp bridge (`longshot-rpc-bridge` bundled in `OcarinaAtlas-Linux-x64.AppImage`):** Reads guest memory strictly read-only via `process_vm_readv()` with `O_RDONLY` `/proc/<pid>/mem` fallback (subject to `kernel.yama.ptrace_scope` and guarded against PID reuse). `process_vm_writev()` is never used.
  - **Local save slots:** Reads `caption.sav` / `progress.sav` in read-only mode and never mutates save files.
- **Release integrity & verified auto-updates**:
  - Official releases are published exclusively on GitHub Releases with companion `.sha256` checksum files and GitHub Actions build provenance attestations (`actions/attest-build-provenance`).
  - `OcarinaAtlas.exe`'s built-in updater enforces official GitHub repository hosts, verifies `.sha256` archive hashes before extracting, and rejects `prerelease` and `draft` payloads.
- **Browser-local persistence**: Map pins, revealed/completed markers, viewport state, and tracker toggles are stored in browser `localStorage` (`oot-map:v1:*`). Launcher preferences are stored locally in `%APPDATA%\OcarinaAtlas\settings.json` (Windows) or `~/.config/ocarina-atlas/settings.json` (Linux).
- **Safe static file serving**: Static asset routes enforce path-containment checks to prevent directory traversal outside the built `dist/client` directory.
- **Upstream analytics note**: The root document includes the upstream `src/lib/analytics.ts` configuration scoped via `data-domains="oot.gousse.cool"`, which does not activate on `127.0.0.1`, `localhost`, or private LAN IP addresses.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities (such as path traversal, arbitrary code execution, unsafe process spawning, or local privilege escalation).

Instead, report vulnerabilities privately:

1. Open the **Security** tab of this GitHub repository and select **Report a vulnerability** (GitHub Private Vulnerability Reporting / Security Advisories), **or**
2. Contact the repository maintainers privately if private advisories are not enabled on your fork.

Please include:

- A clear description of the vulnerability and potential impact.
- Affected files, endpoints, or launcher behaviors.
- Step-by-step reproduction instructions or a minimal proof of concept.
- Your environment details (Windows or Linux distribution/version, Node.js version, emulator/recomp version, or release version).

You can expect an acknowledgment within a reasonable timeframe and coordinated disclosure once a fix is verified.

## Safe Sharing Guidelines for Bug Reports

When filing public issues or sharing logs:

- **Never** attach copyrighted game ROMs, decryption keys, or full NAND dumps.
- **Avoid** uploading full save archives or raw memory dumps unless specifically requested, and sanitize local usernames/paths if needed.

For contribution guidelines and community standards, see [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
