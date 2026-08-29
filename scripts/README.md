# scripts/

| Script | What it does |
| --- | --- |
| `dev.mjs` | Backs `npm run dev` / `npm start`. Wraps electron-vite purely to scrub `ELECTRON_RUN_AS_NODE` (see Gotcha below). |
| `make-icon.mjs` | Generates `resources/icon.png`, the source image electron-builder turns into `.ico`/`.icns`. Run with `npm run icon`. |

## Smoke drivers

Playwright-driven checks that launch the **real** app, not the test suite.

| Script | What it proves |
| --- | --- |
| `drive.mjs` | The app launches, the preload bridge is attached with no Node leak into the renderer, the welcome screen renders, and IPC round-trips to the main process. Writes a screenshot to `.shots/` (override with `SHOT_DIR`). |
| `drive-export.mjs` | The whole export pipeline: create a project, write a take, generate `sounds.json` + `pack.mcmeta`, encode to Ogg Vorbis and zip it — then verifies the artefact with ffmpeg. |

```bash
npm run build
node scripts/drive.mjs
node scripts/drive-export.mjs
```

Add `APP_EXE=<path to the built .exe>` to point a driver at a packaged build
instead of the dev tree — the only way to catch bugs that exist solely inside
the asar, such as the ffmpeg path rewrite.

## Gotcha: ELECTRON_RUN_AS_NODE

Every script here strips `ELECTRON_RUN_AS_NODE` from the child environment, and
that is not paranoia. Electron-based editors export it for their own helper
processes; anything launched from such an environment inherits it, and Electron
then boots as plain Node. `require('electron')` returns a path string instead of
the API, so the app dies before opening a window with:

```
TypeError: Cannot read properties of undefined (reading 'isPackaged')
```

which says nothing about the actual cause. `npm run dev` goes through `dev.mjs`
specifically so this can never bite during normal development.
