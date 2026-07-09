// Generates the placeholder PWA icons (public/icon-192.png, icon-512.png,
// apple-touch-icon.png) with only the Node standard library — no image deps.
// Each is a teal (#0d9488, the app accent) square with a white "L" glyph.
// Re-run with `node scripts/gen-icons.mjs` to regenerate after a design change.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const TEAL = [13, 148, 136] // #0d9488

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (~c) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function iconPng(size) {
  const stroke = Math.round(size * 0.12)
  const x0 = Math.round(size * 0.34), y0 = Math.round(size * 0.26)
  const y1 = Math.round(size * 0.74), x2 = Math.round(size * 0.66)
  const raw = Buffer.alloc(size * (1 + size * 3))
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0 // per-row filter: none
    for (let x = 0; x < size; x++) {
      const onGlyph = (x >= x0 && x < x0 + stroke && y >= y0 && y < y1) // vertical bar
        || (y >= y1 - stroke && y < y1 && x >= x0 && x < x2)            // bottom bar
      if (onGlyph) { raw[o++] = 255; raw[o++] = 255; raw[o++] = 255 }
      else { raw[o++] = TEAL[0]; raw[o++] = TEAL[1]; raw[o++] = TEAL[2] }
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 2 // 8-bit, colour type 2 (RGB)
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(new URL(`../public/${file}`, import.meta.url), iconPng(size))
  console.log('wrote public/' + file)
}
