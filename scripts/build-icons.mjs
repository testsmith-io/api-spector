/**
 * Zero-dependency ghost icon generator — uses only Node.js built-ins.
 * Run: npm run build:icons
 */
import { writeFileSync, mkdirSync } from 'fs'
import { deflateSync } from 'zlib'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// ─── CRC32 (required by PNG format) ──────────────────────────────────────────
const CRC_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  CRC_TABLE[i] = c
}
function crc32(buf) {
  let crc = 0xffffffff
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// ─── PNG writer ───────────────────────────────────────────────────────────────
function pngChunk(type, data) {
  const tb = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([tb, data])))
  return Buffer.concat([len, tb, data, crcBuf])
}

function encodePng(pixels, size) {
  // pixels = Uint8Array of size*size*4 (RGBA)
  const rows = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4)
    row[0] = 0 // filter: None
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4
      row[1 + x * 4]     = pixels[src]
      row[2 + x * 4]     = pixels[src + 1]
      row[3 + x * 4]     = pixels[src + 2]
      row[4 + x * 4]     = pixels[src + 3]
    }
    rows.push(row)
  }
  const idat = deflateSync(Buffer.concat(rows), { level: 9 })
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6 // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ─── Color helpers ───────────────────────────────────────────────────────────
function lerp(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}
function applyOverlay(base, overlay, alpha) {
  return lerp(base, overlay, Math.min(1, Math.max(0, alpha)))
}

// ─── Ghost rasterizer ─────────────────────────────────────────────────────────
function renderGhost(size) {
  const s  = size / 256          // scale factor
  const cx = size / 2

  // Ghost geometry (designed at 256×256, scaled)
  const headCy   = 118 * s
  const headR    = 76  * s
  const bodyBot  = 200 * s
  const scallR   = headR / 3     // 3 scallops tile perfectly across 2×headR

  const s1x = cx - 2 * scallR
  const s2x = cx
  const s3x = cx + 2 * scallR

  // Eyes (ellipses)
  const LE = { x: 100 * s, y: 142 * s, rx: 17 * s, ry: 20 * s }
  const RE = { x: 156 * s, y: 142 * s, rx: 17 * s, ry: 20 * s }
  // Pupils (circles, offset slightly inward/down + animated offset)
  const LP = { x: 103 * s, y: 146 * s, r: 10 * s }
  const RP = { x: 159 * s, y: 146 * s, r: 10 * s }
  // Eye shines
  const LS = { x:  95 * s, y: 135 * s, r:  4 * s }
  const RS = { x: 151 * s, y: 135 * s, r:  4 * s }

  // Rounded background (macOS icon style, radius ≈ 11.3% of size)
  const bgR = size * 0.113

  // Colors (RGB)
  const C_BG    = [0x1e, 0x1b, 0x2e]
  const C_BODY  = [0x20, 0x5d, 0x96]  // Testsmith blue
  const C_HIGH  = [0x6a, 0xa3, 0xc8]  // highlight
  const C_WHITE = [0xff, 0xff, 0xff]
  const C_PUPIL = [0x14, 0x12, 0x22]
  const C_TRANS = null               // transparent corner (bg color)

  const pixels = new Uint8Array(size * size * 4) // RGBA

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4

      // Ghost body
      const inCircle = (x - cx) ** 2 + (y - headCy) ** 2 <= headR ** 2
      const inRect   = Math.abs(x - cx) <= headR && y >= headCy && y <= bodyBot
      const inS1     = (x - s1x) ** 2 + (y - bodyBot) ** 2 <= scallR ** 2
      const inS2     = (x - s2x) ** 2 + (y - bodyBot) ** 2 <= scallR ** 2
      const inS3     = (x - s3x) ** 2 + (y - bodyBot) ** 2 <= scallR ** 2
      const inBody   = inCircle || inRect || inS1 || inS2 || inS3

      if (!inBody) {
        // Transparent — let the dock background show through
        pixels[idx] = 0; pixels[idx+1] = 0; pixels[idx+2] = 0; pixels[idx+3] = 0
        continue
      }

      // Eyes
      const inLE = ((x - LE.x) / LE.rx) ** 2 + ((y - LE.y) / LE.ry) ** 2 <= 1
      const inRE = ((x - RE.x) / RE.rx) ** 2 + ((y - RE.y) / RE.ry) ** 2 <= 1
      const inLP = (x - LP.x) ** 2 + (y - LP.y) ** 2 <= LP.r ** 2
      const inRP = (x - RP.x) ** 2 + (y - RP.y) ** 2 <= RP.r ** 2
      const inLS = (x - LS.x) ** 2 + (y - LS.y) ** 2 <= LS.r ** 2
      const inRS = (x - RS.x) ** 2 + (y - RS.y) ** 2 <= RS.r ** 2

      // Ghost body: radial gradient (light source top-left)
      const distFromLight = Math.sqrt((x - cx * 0.7) ** 2 + (y - headCy * 0.5) ** 2)
      const bodyT = Math.min(1, distFromLight / (headR * 1.6))
      const bodyColor = lerp([0x54, 0x97, 0xc8], lerp([0x20, 0x5d, 0x96], [0x12, 0x3a, 0x60], 0.5), bodyT)

      // Glass gloss clipped to ghost body
      const glossEllipse = ((x - cx) / (headR * 1.3)) ** 2 + ((y - headCy * 0.35) / (headR * 1.15)) ** 2
      const glossAlpha = glossEllipse <= 1 ? Math.max(0, 0.42 * (1 - glossEllipse)) : 0

      let c
      if (inLP || inRP) c = C_PUPIL
      else if (inLS || inRS) c = C_WHITE
      else if (inLE || inRE) c = C_WHITE
      else c = bodyColor

      c = applyOverlay(c, [255, 255, 255], glossAlpha)

      pixels[idx] = c[0]; pixels[idx+1] = c[1]; pixels[idx+2] = c[2]; pixels[idx+3] = 255
    }
  }

  return encodePng(pixels, size)
}

// ─── Generate ─────────────────────────────────────────────────────────────────
mkdirSync(join(root, 'build'), { recursive: true })
// Main icon sizes
for (const size of [1024, 512, 256]) {
  const png = renderGhost(size)
  const filename = size === 1024 ? 'icon.png' : `icon@${size}.png`
  writeFileSync(join(root, 'build', filename), png)
  console.log(`✓ build/${filename} (${size}×${size})`)
}

