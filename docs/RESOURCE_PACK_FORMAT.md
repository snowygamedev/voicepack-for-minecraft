# Resource pack notes

Working notes on the format we generate. These are the details that decide
whether a pack loads and plays, gathered in one place so the builder code can
stay short.

## Layout

```
pack.zip
├── pack.mcmeta                 # required
├── pack.png                    # optional, 128×128 icon
└── assets/
    └── minecraft/              # namespace we override
        ├── sounds.json         # event → file mapping
        └── sounds/
            └── voicepack/…/1.ogg
```

The zip's root must contain `pack.mcmeta` directly. A pack zipped with an extra
top-level folder is the single most common reason a pack "doesn't show up".

## pack.mcmeta

```json
{
  "pack": {
    "pack_format": 55,
    "description": "Sounds recorded by me"
  }
}
```

`pack_format` must match the target version or the pack is listed as
incompatible. Newer clients also accept `supported_formats: [min, max]` to cover
a range; older clients ignore it. The table lives in
[`src/shared/pack-formats.ts`](../src/shared/pack-formats.ts) and needs updating
each release — anything past the last entry there should be treated as unverified,
which is why the UI allows a manual number.

## sounds.json

```json
{
  "entity.zombie.hurt": {
    "replace": true,
    "category": "hostile",
    "subtitle": "subtitles.entity.zombie.hurt",
    "sounds": [
      { "name": "voicepack/entity/zombie/hurt/1", "volume": 1.0, "weight": 2 }
    ]
  }
}
```

- `name` is relative to `assets/<namespace>/sounds/` and has **no extension**.
- `replace: true` discards vanilla's variants; `false` adds ours to the pool.
- `category` decides which volume slider applies. Get it wrong and the player's
  Music slider silences their zombies.
- `weight` only matters with more than one entry — it biases random selection.
- `stream: true` plays from disk instead of memory; correct for anything long
  (music, records). Streamed sounds cannot be positioned as precisely.
- `pitch` and `volume` are multipliers applied on top of whatever the game asks
  for, not absolute levels.

## Audio requirements

| Requirement | Why |
| --- | --- |
| **Ogg Vorbis** | The engine has no Opus or MP3 decoder. Opus in an `.ogg` container fails silently. |
| **Mono** for positional sounds | Stereo files are played without 3D positioning, as if they were music. |
| 44.1 or 48 kHz | Other rates work but get resampled. |

## Testing a pack

Minecraft caches resource packs aggressively. To re-test after an export,
toggle the pack off and on in Options → Resource Packs, or press `F3 + T` to
reload packs without restarting.
