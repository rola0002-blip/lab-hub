import { describe, it, expect } from 'vitest'
import { crc32 } from 'node:zlib'
import { buildStoredZip, zipEntryName } from '@/features/documents/zip'

// Minimal STORED-zip reader: walk local headers, then assert the central directory
// mirrors them. Offsets per the APPNOTE layout the writer above encodes.
function parse(buf: Buffer) {
  expect(buf.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04')
  const names: { name: string; data: Buffer; crc: number }[] = []
  let p = 0
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const nameLen = buf.readUInt16LE(p + 26)
    const size = buf.readUInt32LE(p + 22)
    const name = buf.subarray(p + 30, p + 30 + nameLen).toString('utf8')
    const data = buf.subarray(p + 30 + nameLen, p + 30 + nameLen + size)
    names.push({ name, data, crc: buf.readUInt32LE(p + 14) })
    p += 30 + nameLen + size
  }
  expect(buf.readUInt32LE(p)).toBe(0x02014b50) // central directory follows directly
  const eocd = buf.subarray(buf.length - 22)
  expect(eocd.subarray(0, 4).toString('latin1')).toBe('PK\x05\x06')
  expect(eocd.readUInt16LE(8)).toBe(names.length)
  return names
}

describe('buildStoredZip', () => {
  it('round-trips entries with names, bytes and CRCs', () => {
    const a = Buffer.from('hello world')
    const b = Buffer.from([1, 2, 3, 254, 255])
    const empty = Buffer.alloc(0)
    const zip = buildStoredZip([{ name: 'a.txt', data: a }, { name: 'chem/liste résumé.pdf', data: b }, { name: 'empty.bin', data: empty }])
    const entries = parse(zip)
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'chem/liste résumé.pdf', 'empty.bin'])
    expect(entries[0].data).toEqual(a)
    expect(entries[0].crc).toBe(crc32(a) >>> 0)
    expect(entries[1].data).toEqual(b)
    expect(entries[2].data.length).toBe(0)
    expect(entries[2].crc).toBe(0)
  })
  it('sets the UTF-8 flag and STORED method', () => {
    const zip = buildStoredZip([{ name: 'x', data: Buffer.from('y') }])
    expect(zip.readUInt16LE(6)).toBe(0x0800)
    expect(zip.readUInt16LE(8)).toBe(0)
  })
  it('builds a valid empty archive (EOCD only)', () => {
    const zip = buildStoredZip([])
    expect(zip.length).toBe(22)
    expect(zip.subarray(0, 4).toString('latin1')).toBe('PK\x05\x06')
    expect(zip.readUInt16LE(8)).toBe(0)
  })
  it('refuses >0xffff entries instead of writing a clamped EOCD count', () => {
    const entries = Array.from({ length: 0x10000 }, () => ({ name: 'x', data: Buffer.alloc(0) }))
    expect(() => buildStoredZip(entries)).toThrow()
  })
})

describe('zipEntryName', () => {
  it('prefixes the folder and keeps root files at the root', () => {
    const used = new Set<string>()
    expect(zipEntryName('chemical list', 'sds.pdf', used)).toBe('chemical list/sds.pdf')
    expect(zipEntryName(null, 'readme.txt', used)).toBe('readme.txt')
  })
  it('dedupes same-name collisions inside a directory', () => {
    const used = new Set<string>()
    expect(zipEntryName('f', 'a.pdf', used)).toBe('f/a.pdf')
    expect(zipEntryName('f', 'a.pdf', used)).toBe('f/a (2).pdf')
    expect(zipEntryName('f', 'a.pdf', used)).toBe('f/a (3).pdf')
    expect(zipEntryName(null, 'a.pdf', used)).toBe('a.pdf')
    expect(zipEntryName(null, 'README', used)).toBe('README')
    expect(zipEntryName(null, 'README', used)).toBe('README (2)')
    expect(zipEntryName(null, '.gitignore', used)).toBe('.gitignore')
    expect(zipEntryName(null, '.gitignore', used)).toBe('.gitignore (2)')
  })
  it('sanitizes separators, control chars, dot-segments and empty names', () => {
    const used = new Set<string>()
    expect(zipEntryName('evil/../../etc', 'x', used)).toBe('evil_.._.._etc/x')
    expect(zipEntryName('..', 'y', used)).toBe('_/y')
    expect(zipEntryName(null, 'a/b\\c.pdf', used)).toBe('a_b_c.pdf')
    expect(zipEntryName(null, '', used)).toBe('_')
    expect(zipEntryName('~~..', 'x', new Set())).toBe('_/x')
    expect(zipEntryName('~.', 'y', new Set())).toBe('_/y')
    expect(zipEntryName('~notes', 'a.pdf', new Set())).toBe('notes/a.pdf')
    for (const out of ['evil_.._.._etc/x', '_/y', 'a_b_c.pdf', '_', '_/x', 'notes/a.pdf']) {
      expect(out).not.toMatch(/(^|\/)\.\.(\/|$)/)
      expect(out).not.toMatch(/(^|\/)\.(\/|$)/)
      expect(out.split('/').every((seg) => seg.length > 0)).toBe(true)
    }
  })
})
