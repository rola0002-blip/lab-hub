import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { buildRaAcknowledgmentsXlsx, orgWallClock, raExportFilename } from '@/features/ra/export'
import type { RaAcknowledgmentDto } from '@/features/ra/ra-service'

// exceljs's typings declare a module-local `interface Buffer extends ArrayBuffer`
// — nominally incompatible with Node's Buffer; bridge through the parameter type
// (the equipment-export test idiom).
async function parse(buf: Buffer): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as unknown as Parameters<ExcelJS.Workbook['xlsx']['load']>[0])
  return wb.getWorksheet('RA acknowledgments')!
}

const ack = (name: string, doc: string, iso: string, matric = 'A0123456X'): RaAcknowledgmentDto => ({
  id: `${name}-${doc}-${iso}`, documentId: `d-${doc}`, documentName: doc, matricNumber: matric, createdAt: iso,
  author: { id: `u-${name}`, name, email: `${name.toLowerCase()}@lab.test` },
})

describe('raExportFilename', () => {
  it('stamps the org-tz day into an ASCII xlsx filename', () => {
    expect(raExportFilename('2026-10-17')).toBe('labhub-ra-acknowledgments-2026-10-17.xlsx')
  })
})

describe('orgWallClock', () => {
  it('moves the org-local wall clock into the UTC fields', () => {
    // 01:00Z on 2 Sep is 09:00 in Singapore (UTC+8)
    expect(orgWallClock(new Date('2026-09-02T01:00:00Z'), 'Asia/Singapore').toISOString()).toBe('2026-09-02T09:00:00.000Z')
    // and the previous calendar day west of UTC
    expect(orgWallClock(new Date('2026-09-02T01:00:00Z'), 'America/New_York').toISOString()).toBe('2026-09-01T21:00:00.000Z')
    // non-hour offsets keep their minutes (+05:30, +05:45)
    expect(orgWallClock(new Date('2026-09-02T01:00:00Z'), 'Asia/Kolkata').toISOString()).toBe('2026-09-02T06:30:00.000Z')
    expect(orgWallClock(new Date('2026-09-02T01:00:00Z'), 'Asia/Kathmandu').toISOString()).toBe('2026-09-02T06:45:00.000Z')
  })
})

describe('buildRaAcknowledgmentsXlsx', () => {
  it('writes a bold frozen filtered header, sized columns, and sorted rows with real date cells', async () => {
    const ws = await parse(await buildRaAcknowledgmentsXlsx([
      ack('zed', 'b-ra.pdf', '2026-09-03T01:00:00.000Z'),
      ack('Amy', 'laser ra.pdf', '2026-09-02T02:00:00.000Z'),
      ack('amy', 'cvd ra.pdf', '2026-09-02T03:00:00.000Z'),
      ack('Amy', 'cvd ra.pdf', '2026-09-02T01:00:00.000Z'),
    ], 'Asia/Singapore'))
    expect(ws.getRow(1).values).toEqual([undefined, 'Name', 'Email', 'Matric', 'RA document', 'Acknowledged (Asia/Singapore)'])
    expect(ws.getRow(1).font?.bold).toBe(true)
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    expect(ws.autoFilter).toBe('A1:E1')
    expect(ws.getColumn(4).width).toBe(44)
    // name (case-insensitive) → RA → time
    const order = [2, 3, 4, 5].map((n) => [ws.getRow(n).getCell(1).value, ws.getRow(n).getCell(4).value])
    expect(order).toEqual([['Amy', 'cvd ra.pdf'], ['amy', 'cvd ra.pdf'], ['Amy', 'laser ra.pdf'], ['zed', 'b-ra.pdf']])
    const at = ws.getRow(2).getCell(5)
    expect(at.value).toBeInstanceOf(Date)
    expect((at.value as Date).toISOString()).toBe('2026-09-02T09:00:00.000Z') // org-local 09:00
    expect(at.numFmt).toBe('yyyy-mm-dd hh:mm')
  })

  it('breaks a same-person same-RA tie by time, oldest first, whatever the input order', async () => {
    const ws = await parse(await buildRaAcknowledgmentsXlsx([
      ack('Amy', 'cvd ra.pdf', '2026-09-02T03:00:00.000Z', 'late'),
      ack('Amy', 'cvd ra.pdf', '2026-09-02T01:00:00.000Z', 'early'),
      ack('Amy', 'cvd ra.pdf', '2026-09-02T02:00:00.000Z', 'mid-a'),
      ack('Amy', 'cvd ra.pdf', '2026-09-02T02:00:00.000Z', 'mid-b'),
    ], 'Asia/Singapore'))
    const matrics = [2, 3, 4, 5].map((n) => ws.getRow(n).getCell(3).value)
    expect(matrics[0]).toBe('early')
    expect(matrics[3]).toBe('late')
    expect(matrics.slice(1, 3).sort()).toEqual(['mid-a', 'mid-b']) // an exact tie keeps both, adjacent
  })

  it('keeps a formula-looking value a literal string', async () => {
    const ws = await parse(await buildRaAcknowledgmentsXlsx([ack('=SUM(A1)', '+evil.pdf', '2026-09-02T01:00:00.000Z', '@x')], 'Asia/Singapore'))
    expect(ws.getRow(2).getCell(1).value).toBe('=SUM(A1)')
    expect(ws.getRow(2).getCell(3).value).toBe('@x')
    expect(ws.getRow(2).getCell(4).value).toBe('+evil.pdf')
  })

  it('an empty export is the header row alone', async () => {
    const ws = await parse(await buildRaAcknowledgmentsXlsx([], 'Asia/Singapore'))
    expect(ws.rowCount).toBe(1)
  })
})
