# Third-party licenses

VoicePack's own source code is MIT licensed — see [LICENSE](LICENSE).

The installers additionally **bundle a compiled FFmpeg binary**, which is not MIT.
This file records what is shipped and where to get its source, as the GPL requires.

## FFmpeg

| | |
| --- | --- |
| Version | 6.1.1 |
| License | **GPL v3** (see `ffmpeg.exe.LICENSE`, shipped inside the app) |
| Obtained via | [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static) 5.3.0, release [`b6.1.1`](https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1) |

### Corresponding source

The complete source for the FFmpeg version distributed with VoicePack is publicly
available and can be downloaded by anyone, with no request to us required:

- FFmpeg upstream: <https://github.com/FFmpeg/FFmpeg>
- The exact commit the bundled Windows build was compiled from:
  <https://github.com/FFmpeg/FFmpeg/commit/e38092ef93>
- Release tarballs: <https://ffmpeg.org/download.html>

If you cannot obtain the source from those locations, open an issue on this
repository and we will provide it.

### Who built the binaries

`ffmpeg-static` ships a prebuilt binary per platform, each from a different maintainer:

| Platform | Builder |
| --- | --- |
| Windows x64 | [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) |
| Linux x64 | [John Van Sickle](https://johnvansickle.com/ffmpeg/) |
| macOS x64 | [evermeet.cx](https://evermeet.cx/pub/ffmpeg/) |
| macOS arm64 | [OSXExperts](https://osxexperts.net/) |

### Why VoicePack itself stays MIT

FFmpeg is never linked into the application. It is shipped as a standalone
executable and invoked as a separate subprocess (see
[`src/main/services/ffmpeg.ts`](src/main/services/ffmpeg.ts)), so the two remain
separate works. The GPL covers the bundled binary; it does not extend to
VoicePack's own code.

## Minecraft

Not affiliated with, endorsed by, or associated with Mojang or Microsoft. No
Mojang-owned assets are included in this repository or in the exported packs —
the sound-event catalog is read from your own Minecraft installation at runtime.
