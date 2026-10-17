import ExcelJS from 'exceljs'
import { TZDate } from '@date-fns/tz'
import type { RaAcknowledgmentDto } from './ra-service'

// W21-B: the admin RA records export as a real workbook (replaces the v0.23 CSV):
// bold frozen header, an autofilter on every column (filter by name, sort A→Z in
// Excel/Numbers/Sheets), sized columns, rows pre-sorted name → RA → time. PURE —
// no prisma, no session: the route owns the gate (canReviewRa, 404-as-deny) and
// hands in already-authorized rows. `import type` keeps ra-service's server-only
// import out of this module.

export const RA_EXPORT_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// `today` is the org-tz yyyy-MM-dd (orgToday) — ASCII-only by construction, so
// the Content-Disposition filename needs no RFC 5987 encoding.
export function raExportFilename(today: string): string {
  return `labhub-ra-acknowledgments-${today}.xlsx`
}

// Excel date cells carry NO timezone, and exceljs serialises a Date from its UTC
// fields. A Date whose UTC fields equal the org's local wall clock therefore
// displays as org-local time in every spreadsheet app; the column header names
// the zone so the value is never ambiguous.
export function orgWallClock(d: Date, timezone: string): Date {
  const z = new TZDate(d.getTime(), timezone)
  return new Date(Date.UTC(z.getFullYear(), z.getMonth(), z.getDate(), z.getHours(), z.getMinutes(), z.getSeconds()))
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

export async function buildRaAcknowledgmentsXlsx(rows: RaAcknowledgmentDto[], timezone: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'LabHub'
  const ws = wb.addWorksheet('RA acknowledgments', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = [
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Email', key: 'email', width: 32 },
    { header: 'Matric', key: 'matric', width: 16 },
    { header: 'RA document', key: 'ra', width: 44 },
    { header: `Acknowledged (${timezone})`, key: 'at', width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
  ]
  ws.getRow(1).font = { bold: true }
  const sorted = [...rows].sort((a, b) =>
    collator.compare(a.author.name, b.author.name)
    || collator.compare(a.documentName, b.documentName)
    || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
  // Plain string values: exceljs stores a string as a string, never a formula, so
  // a hostile '=…' name/matric/title stays inert (the CSV apostrophe guard has
  // no xlsx equivalent to carry over).
  ws.addRows(sorted.map((r) => ({
    name: r.author.name,
    email: r.author.email,
    matric: r.matricNumber,
    ra: r.documentName,
    at: orgWallClock(new Date(r.createdAt), timezone),
  })))
  ws.autoFilter = { from: 'A1', to: 'E1' }
  return Buffer.from(await wb.xlsx.writeBuffer())
}
