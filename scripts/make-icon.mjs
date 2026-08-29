// Generates resources/icon.png, the source image electron-builder converts into
// .ico / .icns / Linux icons at package time.
//
// It's generated rather than committed as an opaque blob so the design is
// reviewable and tweakable in a diff. Pixel art, upscaled with hard edges,
// because that's the visual language of the game this targets.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import * as path from 'node:path'

const SIZE = 512
const GRID = 16
const CELL = SIZE / GRID

// . = background, # = mic capsule, o = stand/arm, (space is ignored)
const ART = [
  '................',
  '................',
  '......####......',
  '.....######.....',
  '.....######.....',
  '.....######.....',
  '.....######.....',
  '.....######.....',
  '....o......o....',
  '....o......o....',
  '....oo....oo....',
  '.....oooooo.....',
  '.......oo.......',
  '.......oo.......',
  '....oooooooo....',
  '................'
]

const BG = [27, 31, 33, 255] // ink-800
const CAPSULE = [122, 186, 82, 255] // grass, nudged brighter for small sizes
const STAND = [195, 204, 208, 255] // ink-200
const CORNER_RADIUS = 96

const px = Buffer.alloc(SIZE * SIZE * 4)

function put(x, y, [r, g, b, a]) {
  const i = (y * SIZE + x) * 4
  px[i] = r
  px[i + 1] = g
  px[i + 2] = b
  px[i + 3] = a
}

/** Distance-based check so the icon gets a modern rounded-square silhouette. */
function insideRoundedSquare(x, y) {
  const r = CORNER_RADIUS
  const cx = Math.min(Math.max(x, r), SIZE - 1 - r)
  const cy = Math.min(Math.max(y, r), SIZE - 1 - r)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (!insideRoundedSquare(x, y)) {
      put(x, y, [0, 0, 0, 0])
      continue
    }
    const cell = ART[Math.floor(y / CELL)]?.[Math.floor(x / CELL)] ?? '.'
    put(x, y, cell === '#' ? CAPSULE : cell === 'o' ? STAND : BG)
  }
}

// ---- minimal PNG writer (RGBA, no interlacing, filter type 0) ----
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return c ^ -1
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // colour type: RGBA
// 10,11,12 stay 0: deflate, adaptive filtering, no interlace

// Each scanline needs a leading filter byte.
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const out = path.resolve(import.meta.dirname, '../resources/icon.png')
mkdirSync(path.dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`wrote ${out} (${SIZE}x${SIZE}, ${png.length} bytes)`)
