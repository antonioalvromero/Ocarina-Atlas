# Security Policy

## Supported Platforms and Versions

Live emulator telemetry and the standalone Windows launcher are currently supported on **Windows x64 only**. The web map interface runs in standard modern browsers on any OS when served via Node.js.

| Component / Version | Supported | Notes |
| --- | --- | --- |
| Latest `main` / current Windows release | Yes | Windows 10/11 x64 (`0400486024DEC000` build) |
| Older snapshots / unmaintained forks | No | Please upgrade before reporting issues |

## Security and Privacy Design

This project is designed to operate locally on the user's machine:

- **LAN second-screen access with opt-out localhost mode**: To support opening the map from an iPad, tablet, or second PC on your home Wi-Fi/LAN out of the box, the map HTTP server binds `0.0.0.0` (`HOST` environment variable / `--lan`) while Lichii's JSON-RPC connection remains strictly local on `127.0.0.1:6545` (`LICHII_HOST` / `LICHII_PORT`) by default. You can restrict the web UI to `127.0.0.1` at any time by unchecking **Allow LAN access** in `OcarinaAtlas.exe` (under **Advanced Settings & Logs**), passing `--local-only`, or setting `HOST=127.0.0.1`.
- **Scoped Windows Firewall helper (explicit user action only)**: Clicking **Allow LAN Access** in `OcarinaAtlas.exe` runs `netsh advfirewall firewall add rule` via UAC elevation only on explicit click, scoped strictly to `profile=private` networks (`Ocarina Atlas (TCP <port>)`), never `public` or `any`.
- **Host header & dev server host validation**: Standalone requests validate incoming `Host` headers via `sanitizeHostHeader()` before URL construction, and Vite dev/preview servers restrict hostnames via `resolveAllowedDevHosts()`.
- **Read-only emulator & save inspection**: Live tracking reads game memory via Lichii's debug RPC (`status`, `read_memory`, `search_memory`) and reads local `caption.sav` / `progress.sav` files in read-only mode. It never writes to game memory or save files.
- **Browser-local persistence**: Map pins, revealed/completed markers, viewport state, and tracker toggles are stored in browser `localStorage` (`oot-map:v1:*`).
- **Safe static file serving**: Static asset routes enforce path-containment checks to prevent directory traversal outside the built `dist/client` directory.
- **Upstream analytics note**: The root document includes the upstream `src/lib/analytics.ts` configuration scoped via `data-domains="oot.gousse.cool"`, which does not activate on `127.0.0.1` or `localhost`.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities (such as path traversal, arbitrary code execution, unsafe process spawning, or local privilege escalation).

Instead, report vulnerabilities privately:

1. Open the **Security** tab of this GitHub repository and select **Report a vulnerability** (GitHub Private Vulnerability Reporting / Security Advisories), **or**
2. Contact the repository maintainers privately if private advisories are not enabled on your fork.

Please include:

- A clear description of the vulnerability and potential impact.
- Affected files, endpoints, or launcher behaviors.
- Step-by-step reproduction instructions or a minimal proof of concept.
- Your environment details (Windows version, Node.js version, Lichii version, or release version).

You can expect an acknowledgment within a reasonable timeframe and coordinated disclosure once a fix is verified.

## Safe Sharing Guidelines for Bug Reports

When filing public issues or sharing logs:

- **Never** attach copyrighted game ROMs, decryption keys, or full NAND dumps.
- **Avoid** uploading full save archives or raw memory dumps unless specifically requested, and sanitize local Windows usernames/paths if needed.

For contribution guidelines and community standards, see [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
