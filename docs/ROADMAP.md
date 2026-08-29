# VoicePack for Minecraft — Development Plan

## 1. What we're building

A desktop app where a user picks a Minecraft sound event (e.g. `entity.zombie.hurt`),
records a replacement with their microphone, and exports a valid resource pack `.zip`
that drops straight into `.minecraft/resourcepacks`.

**Non-goals (for now):** texture/model editing, multiplayer sync, cloud sync,
shipping any Mojang-owned asset.

## 2. Constraints that drive the design

| Constraint | Consequence |
| --- | --- |
| Minecraft only plays **Ogg Vorbis** — not Opus, not MP3 | Browser `MediaRecorder` output is unusable. We capture raw PCM and encode to Vorbis ourselves. |
| Positional (3D) sounds must be **mono** | Downmix to 1 channel on export; warn on stereo. |
| We may not redistribute Mojang assets | The sound-event catalog is read entirely from the user's *own* Minecraft install at runtime; the app ships no list of its own, and copies no audio. |
| `pack_format` changes almost every Minecraft release | Version→format table is data, editable, with a manual override. |
| Re-encoding a lossy file loses quality | Projects store **lossless WAV** masters; `.ogg` is generated only at export. |

## 3. Architecture

```
┌─ renderer (React + TS) ───────────────┐
│  UI, Web Audio capture, waveform      │
│  raw Float32 PCM ──► WAV bytes        │
└──────────────┬────────────────────────┘
               │ contextBridge (typed, no nodeIntegration)
┌──────────────▼────────────────────────┐
│ preload — narrow allow-listed surface │
└──────────────┬────────────────────────┘
┌──────────────▼────────────────────────┐
│ main (Node)                           │
│  project store · MC installation scan │
│  ffmpeg resolver · ogg encode         │
│  sounds.json + pack.mcmeta + zip      │
└───────────────────────────────────────┘
```

Rules: renderer never touches `fs`; every IPC channel is declared once in
`src/shared/ipc.ts` and typed end-to-end; all payloads crossing the bridge are
validated with Zod in main.

## 4. Project file format

A project is a **directory**, not an opaque blob — diffable, backup-friendly,
and recoverable by hand if the app breaks.

```
MyPack.voicepack/
  project.json          # metadata + event→take mapping (schema-versioned)
  takes/
    entity.zombie.hurt/
      take-01.wav       # lossless master, 48 kHz mono
      take-02.wav
  pack.png              # optional pack icon
```

Export compiles that into:

```
MyPack.zip
  pack.mcmeta
  pack.png
  assets/minecraft/sounds.json
  assets/minecraft/sounds/voicepack/<event_path>/<n>.ogg
```

## 5. Milestones

Status is deliberately split: **verified** means it was exercised against the
running app, **written** means the code exists and typechecks but has not been
driven end to end.

### M0 - Scaffolding — verified
Electron + Vite + React + TypeScript, Tailwind, typed IPC, ESLint/Prettier,
electron-builder config, Vitest. `npm run dev`, `npm run build`, `npm test` and
`npm run lint` all pass; the app launches and the preload bridge attaches with
no Node leak into the renderer.

### M1 - Projects — verified
Create / open / save a project directory, Zod-validated `project.json`,
recent-projects list (pruned of dead entries), debounced autosave.

### M2 - Sound event catalog — partly verified
Seed catalog of 140 common events loads. The jar scanner and asset-index reader
are **written but unverified** — there is no Minecraft install on the dev
machine to scan, so `inspectInstall` has only been exercised down the
"not found" path.

### M3 - Recording — written
AudioWorklet PCM capture, level meter with peak-hold, multiple takes per event,
waveform, take selection. Cannot be driven headlessly: it needs a real
microphone and a `getUserMedia` grant. **Needs a human pass.**

### M4 - Editing — partly written
Trim in/out, gain, and A/B against the original vanilla sound are wired through
to export. Still to do: drag handles on the waveform (currently numeric fields
only), normalise-to-peak per take, fades.

### M5 - Export — verified
Driven end to end: project -> take -> `sounds.json` + `pack.mcmeta` -> Ogg
Vorbis -> zip. The emitted audio was decoded back and confirmed as
`Audio: vorbis, 48000 Hz, mono`, which is what Minecraft requires. One-click
install into `resourcepacks` is written but unverified (no install present).

### M6 - Polish — not started
Pre-export validation exists (silent/clipping/empty-after-trim/long-sound streaming
warnings). Still to do: keyboard-driven record loop across many events, pack
icon editor, i18n-ready strings.

## 6. Open decisions

1. **Vorbis encoder.** Currently: resolve `ffmpeg` from (1) user setting,
   (2) bundled `ffmpeg-static`, (3) `PATH`. `ffmpeg-static` ships GPL builds — fine
   as a separately-invoked subprocess, but if we want a pure-MIT distribution we
   swap in a libvorbis WASM encoder. `AudioEncoder` is an interface precisely so
   this is a one-file change.
2. **`pack_format` beyond 1.21.5** — table needs verifying against each release.
3. Whether to support `sounds.json` merging with an existing third-party pack.
