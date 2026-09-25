// Stored-entry (uncompressed) ZIP writer — zero deps. Wave 18: a lab Files library
// is dominated by pdf/office/images that are already compressed, so DEFLATE would
// cost CPU for ~nothing; STORED keeps the format byte-testable. Node-only imports
// (node:zlib) — this module is NEVER imported by a client component.
import { crc32 } from 'node:zlib'

export type ZipEntry = { name: string; data: Buffer }

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const UTF8_FLAG = 0x0800 // bit 11: names are UTF-8 (non-ASCII doc names are real — 'CVD résumé.pdf')
const METHOD_STORED = 0
const VERSION = 20

function dosDateTime(d: Date): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

export function buildStoredZip(entries: ZipEntry[]): Buffer {
  if (entries.length > 0xffff) throw new Error('too many entries for a single ZIP32 archive')
  const { time, date } = dosDateTime(new Date())
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const crc = crc32(e.data) >>> 0
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(LOCAL_SIG, 0)
    local.writeUInt16LE(VERSION, 4)
    local.writeUInt16LE(UTF8_FLAG, 6)
    local.writeUInt16LE(METHOD_STORED, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(e.data.length, 18)
    local.writeUInt32LE(e.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    locals.push(local, e.data)
    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(CENTRAL_SIG, 0)
    central.writeUInt16LE(VERSION, 4) // version made by
    central.writeUInt16LE(VERSION, 6) // version needed
    central.writeUInt16LE(UTF8_FLAG, 8)
    central.writeUInt16LE(METHOD_STORED, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(e.data.length, 20)
    central.writeUInt32LE(e.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    // extra 30 / comment 32 / disk 34 / internal 36 / external 38 stay 0
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centrals.push(central)
    offset += local.length + e.data.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(EOCD_SIG, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

// Entry-name hygiene + collision dedupe. We control both segments (folder + doc
// names), but stored names are user text: strip path separators/control chars so a
// name can never mint or escape a directory, and dedupe ` (n)`-style inside the
// SAME directory so two 'sds.pdf' in 'chemical list' both survive the export.
export function zipEntryName(folderName: string | null, docName: string, used: Set<string>): string {
  const clean = (s: string) => {
    const t = s.replace(/[/\\\x00-\x1f]/g, '_').replace(/^~+/, '').trim()
    return t === '' || /^\.+$/.test(t) ? '_' : t
  }
  const folder = folderName ? clean(folderName) : null
  const base = clean(docName)
  let path = folder ? `${folder}/${base}` : base
  if (used.has(path)) {
    const dot = base.lastIndexOf('.')
    const stem = dot > 0 ? base.slice(0, dot) : base
    const ext = dot > 0 ? base.slice(dot) : ''
    for (let n = 2; ; n++) {
      const candidate = folder ? `${folder}/${stem} (${n})${ext}` : `${stem} (${n})${ext}`
      if (!used.has(candidate)) { path = candidate; break }
    }
  }
  used.add(path)
  return path
}
