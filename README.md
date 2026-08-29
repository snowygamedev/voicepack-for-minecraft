# VoicePack for Minecraft

Record Minecraft's sounds in your own voice, and get back a resource pack you can drop straight into the game.

> Not affiliated with, endorsed by, or associated with Mojang or Microsoft. No official Minecraft files are included.

## Download

**[⬇ Get the latest version](../../releases/latest)**

| Your computer | File to download |
| --- | --- |
| Windows | `VoicePack-x.y.z-windows-setup.exe` |
| Mac (Apple Silicon — M1 and newer) | `VoicePack-x.y.z-mac-arm64.dmg` |
| Mac (Intel) | `VoicePack-x.y.z-mac-x64.dmg` |
| Linux | `VoicePack-x.y.z-linux-x64.AppImage` |

Nothing else to install — ffmpeg and everything else needed is inside the download.

<details>
<summary><b>"Windows protected your PC" / "VoicePack is damaged"</b> — read this first</summary>

These builds aren't code-signed, because a signing certificate costs a few hundred
dollars a year. Your operating system doesn't know who made the app, so it warns you.
Nothing is wrong with the download — but you should only bypass this for software you
actually trust.

**Windows** — on the blue "Windows protected your PC" box, click **More info**, then
**Run anyway**.

**macOS** — after dragging the app to Applications, open Terminal and run:

```bash
xattr -cr "/Applications/VoicePack for Minecraft.app"
```

Then open it normally. (Right-click → Open works on some macOS versions, but the
command above is more reliable on Apple Silicon.)

**Linux** — make it executable, then run it:

```bash
chmod +x VoicePack-*.AppImage
./VoicePack-*.AppImage
```

</details>

## Using it

1. **Create a pack.** Give it a name and pick your Minecraft version.
2. **Point it at Minecraft** (Settings → Choose). This loads the full list of sound
   events for your exact version and lets you hear the original sound before you
   replace it. Optional, but it makes everything easier.
3. **Pick a sound** — search for something like `entity.zombie.hurt`. The list is
   grouped by category (the in-game volume slider each sound obeys), and you can drag
   the divider to make it wider. Already have a list of sound ids? **Add list...**
   takes a paste of one id per line and adds them all at once.
4. **Press Space to record**, press Space again to stop. Record as many takes as you
   like and keep the best one. The silence either side of your sound is trimmed off
   automatically (Settings turns that off; *Reset edits* puts it back).
5. **Clean-up is on by default** (Settings → Noise filter / Voice enhancer). The
   filter removes rumble and steady background hiss; the enhancer lifts the
   consonants and evens out loud and quiet words. Turn either off if you would
   rather keep the raw sound. **Play cleaned** on a take lets you
   hear the result before exporting. Both are applied at export only — your recordings
   on disk are never altered.
6. **Export pack.** Tick "copy into my resourcepacks folder" and it lands where
   Minecraft can see it.
7. In Minecraft: **Options → Resource Packs**, move your pack to the right-hand
   column, and press Done.

Recording a pack with someone else? **Merge pack** copies another VoicePack project's
recordings into the one you have open — ideal when you each took a different half of
the list. Where you both recorded the same sound, you choose whether to keep yours,
keep both, or take theirs. The other pack is never modified.

Tip: press `F3 + T` in-game to reload resource packs after re-exporting, instead of
restarting.

## How it works

Minecraft's sound engine only decodes **Ogg Vorbis** — not Opus, not MP3 — and only
positions **mono** sounds in 3D space. So the app records raw uncompressed audio and
keeps a lossless WAV master of every take, converting to Vorbis once, at export. That
means you can re-trim, re-balance and re-export as many times as you want without the
audio degrading.

A project is a plain folder, not a mystery file:

```
MyPack/
  project.json          # metadata + which take belongs to which sound
  takes/
    entity/zombie/hurt/
      take-01.wav       # your lossless recording
```

Export turns that into a standard resource pack:

```
MyPack.zip
  pack.mcmeta
  assets/minecraft/sounds.json
  assets/minecraft/sounds/voicepack/entity/zombie/hurt/1.ogg
```

The sound-event list comes from a small built-in starter list plus a scan of **your
own** Minecraft installation — the app reads event names out of your version's jar so
the list always matches what you're building for. Nothing from your Minecraft folder
is copied into your project or your exported pack.

---

## For developers

Requires **Node.js 20.11+**.

```bash
git clone https://github.com/snowygamedev/voicepack-for-minecraft.git
cd voicepack-for-minecraft
npm install
npm run dev
```

### Day to day

On Windows, **double-click [`Start-Dev.cmd`](Start-Dev.cmd)**. It installs
dependencies on a fresh clone, launches the app, and stays open showing the log.
(Right-click → *Send to* → *Desktop (create shortcut)* to pin it somewhere handy.)

Otherwise:

```bash
npm run dev
```

Either way it opens the app and watches everything:

| You change... | What happens |
| --- | --- |
| `src/renderer/**` (UI) | Updates instantly, no restart, state preserved |
| `src/main/**` or `src/preload/**` | App restarts automatically |
| `src/shared/**` | Whichever side imports it reloads |

Press **F12** in the app window for DevTools. `Ctrl+C` in the terminal stops it.

To check something without clicking through the UI yourself:

```bash
npm test                      # unit tests, ~0.5s
node scripts/drive.mjs        # launches the app, screenshots it, checks IPC
node scripts/drive-export.mjs # full export pipeline, verifies the .ogg output
```

### All commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Run with hot reload |
| `npm run build` | Typecheck and build |
| `npm test` | Unit tests |
| `npm run lint` | Lint |
| `npm run icon` | Regenerate `resources/icon.png` |
| `npm run pack:dir` | Package without building an installer |
| `npm run dist:win` / `dist:mac` / `dist:linux` | Build an installer |

### Layout

```
src/
  main/       Electron main process — files, scanning, encoding, packaging
  preload/    The single typed bridge between renderer and main
  renderer/   React UI, Web Audio capture and playback
  shared/     Types, Zod schemas and the IPC contract used by both sides
scripts/      Icon generator and Playwright smoke drivers
docs/         Development plan and resource pack format notes
```

### Releasing

Bump `version` in `package.json`, then:

```bash
git tag v0.1.0
git push --tags
```

[`.github/workflows/release.yml`](.github/workflows/release.yml) builds installers for
all three platforms and attaches them to a draft GitHub Release for you to publish.

> **Local Windows packaging quirk.** electron-builder downloads a signing bundle
> containing macOS symlinks, and Windows refuses to extract those without
> [Developer Mode](https://learn.microsoft.com/en-us/windows/apps/get-started/enable-your-device-for-development)
> or an admin shell. Both `dist:win` and `pack:dir` will report an error because of
> it — but `pack:dir` still leaves a working app in `release/win-unpacked`, so it's
> fine for local testing. Producing an actual installer needs Developer Mode, or
> just let CI do it. GitHub's runners have the privilege and are unaffected.

See [docs/ROADMAP.md](docs/ROADMAP.md) for the development plan and
[docs/RESOURCE_PACK_FORMAT.md](docs/RESOURCE_PACK_FORMAT.md) for notes on the pack
format.

## License

MIT — see [LICENSE](LICENSE). This covers the app's code only, not Minecraft's name or
assets. The bundled ffmpeg binary is distributed under its own license (see
`ffmpeg.exe.LICENSE` inside the app).
