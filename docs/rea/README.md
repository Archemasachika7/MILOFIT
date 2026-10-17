# REA analysis of the MILOFIT web build

Command (run from repo root, with `~/.local/bin` on PATH):

    rea analyze-javascript-application web --format json > docs/rea/web-js-evidence.json

Result summary (static, no execution):
- Target: `web/` (directory artifact), 4 source files: `index.html`, `game.js`, `maps.js`, `weapons.js`.
- Graph: 9 nodes (4 `javascript-asset`, 2 `javascript-module`, 1 `artifact` root plus per-file artifacts, 1 `electron-renderer` entrypoint from `index.html`).
- Script entrypoints resolved from `index.html`; all sources parsed completely.
- No integrity contradictions.

The full Evidence JSON (~3 MB) is git-ignored; regenerate it with the command above.
