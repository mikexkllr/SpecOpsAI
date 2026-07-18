---
name: verify
description: Build, launch, and drive the SpecOps Electron app end-to-end to verify changes at the real UI surface.
---

# Verifying SpecOps changes

SpecOps is an Electron app (main: `dist/main/main.js`, renderer via vite). The
renderer talks to the main process only through the `window.specops` preload
bridge, so loading the vite URL in a plain browser does NOT work — drive the
real Electron app with Playwright's `_electron` support (playwright is already
a dependency of this repo).

## Recipe that works

1. Build: `npm run build:app` (main tsc + vite build; dev Electron loads vite,
   so also start it: `npx vite --port 5173 &` — unpackaged Electron is isDev
   and loads `http://localhost:5173`).
2. Driver script (node .mjs): `createRequire(<repo>/package.json)` →
   `require("playwright")._electron.launch({ executablePath: require("electron"), args: [repo], cwd: repo })`,
   then `app.firstWindow()`.
3. Seed state through the real bridge with `page.evaluate`:
   `window.specops.loadProject(fixture)` → `createSpec` → `writeArtifact` →
   `saveSession({projectPath, activeSpecId, phase})` → `page.reload()` lands
   directly in the wanted phase. **Snapshot `getSession()` first and restore
   it at the end — it is the user's real session file.**
4. Fixture project: a git repo with a package.json (`react` in deps marks it
   web-based; `"dev": "node server.js --port 4173"` gives the preview a
   command + port; the server printing `listening on http://localhost:4173`
   exercises URL detection).
5. Implementation-view selectors: tabs are `.tabs button:has-text('…')`;
   walkthrough `.walkthrough-view` / `.wt-line.hl`; preview `.preview-url`,
   `webview.preview-webview`; playwright runner `.runner-console`, badges in
   `.card .badge`.

## Gotchas

- Agent features (walkthrough generation, workers) need an LLM key — seed
  their persisted artifacts instead (e.g. `<spec>/.specops/walkthrough.json`).
- To make the playwright runner "installed" without a slow npm install: fake
  `node_modules/@playwright/test/package.json` in the fixture and symlink this
  repo's `node_modules/{.bin/playwright,playwright,playwright-core}` — a run
  then fails fast with MODULE_NOT_FOUND, which still exercises
  spawn/stream/result UI.
- Kill the background vite when done (`pkill -f "vite --port 5173"`).
