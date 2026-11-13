# Ocarina Atlas Release Notes Guidelines

Write clear, concise, player- and contributor-friendly GitHub release notes in English for **Ocarina Atlas** (live Lichii telemetry + Windows launcher extension for *The Legend of Zelda: Ocarina of Time* Remake `0400486024DEC000`), matching the release note style of [`zortos293/Lichii`](https://github.com/zortos293/Lichii/releases).

## Structure & Formatting Rules
- **Do not** output a top-level `#` H1 title, a `## Changes since ...` heading, a `Built from ...` metadata line, or `## Downloads` / `## Windows` sections. Those structural blocks and checksum tables are injected deterministically around your summary.
- **Start with one blockquote callout** (`> **<Short bold headline>.** <1–2 plain-English sentences>`) highlighting the single biggest user-facing change or Windows quick-start tip, using **bold** for UI labels and menu items.
- **Group detailed changes under H3 category headings** (omit any heading with no applicable changes):
  - `### New features`
  - `### Bug fixes`
  - `### Telemetry & Map Tracking`
  - `### Windows Launcher`
  - `### Stability, docs & CI`
- **Use bold-led plain-language bullets:**
  - Start every bullet with a bold outcome or topic: `- **<Bold topic or outcome>.** <Plain explanation of what changed for players or contributors> (#PR)` or `- **<Bold topic>:** <plain detail> (\`shortSha\`).`
  - Never emit raw conventional commit prefixes (`feat:`, `fix(telemetry):`, `chore:`) or lead bullets with commit SHAs.
- **Strict factual accuracy:**
  - Mention exact filenames, commands, CLI flags, or settings only when present in the provided commits, pull requests, or changelog context.
  - Never invent features, bug fixes, benchmarks, or supported builds absent from the supplied changes.
  - Keep the summary crisp and scannable (under ~350 words).
