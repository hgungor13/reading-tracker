// Generates placeholder PNG app icons (solid indigo with a simple "page" mark)
// with zero dependencies, using a tiny hand-rolled PNG encoder.
// Replace public/icons/* with real artwork later.
//
// Usage: node scripts/generate-icons.mjs

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
mkdirSync(OUT, { recursive: true })

const INDIGO = [79, 70, 229, 255] // #4f46e5
const WHITE = [255, 255, 255, 255]
const TRANSPARENT = [0, 0, 0, 0]

// CRC32 (PNG chunk checksum)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

// paint(x, y, size) -> [r,g,b,a]
function encodePng(size, paint) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  let p = 0
  for (let y = 0; y < size; y++) {
    raw[p++] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = paint(x, y, size)
      raw[p++] = r
      raw[p++] = g
      raw[p++] = b
      raw[p++] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// A solid indigo tile with a white centered "page" rectangle + a fold line.
function appIcon(x, y, size) {
  const inset = size * 0.3
  const inX = x > inset && x < size - inset
  const inY = y > size * 0.24 && y < size - size * 0.24
  if (inX && inY) return WHITE
  return INDIGO
}

// Monochrome white glyph on transparent — for the notification badge.
function badge(x, y, size) {
  const inset = size * 0.28
  const inX = x > inset && x < size - inset
  const inY = y > size * 0.2 && y < size - size * 0.2
  return inX && inY ? WHITE : TRANSPARENT
}

const jobs = [
  ['icon-192.png', 192, appIcon],
  ['icon-512.png', 512, appIcon],
  ['icon-512-maskable.png', 512, appIcon],
  ['apple-touch-icon.png', 180, appIcon],
  ['badge-72.png', 72, badge],
]

for (const [name, size, paint] of jobs) {
  writeFileSync(join(OUT, name), encodePng(size, paint))
  console.log('wrote', name, `(${size}x${size})`)
}
