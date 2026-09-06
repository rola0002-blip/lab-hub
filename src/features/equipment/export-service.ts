import ExcelJS from 'exceljs'
import { prisma } from '@/lib/db'
import { formatDateTime, formatRange } from '@/lib/time'

// Pure filename helper (unit-tested): ASCII-safe attachment filename from the
// equipment name — `labhub-<slug>-records.xlsx`, never empty (unicode-only
// names fall back to `equipment`; no RFC 5987 needed).
export function exportFilename(equipmentName: string): string {
  const slug = equipmentName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `labhub-${slug || 'equipment'}-records.xlsx`
}

export type EquipmentRecordsExport = { filename: string; body: Buffer }

// Caller (the route) owns the permission gate — isManagerOf → 404-as-deny (the
// /api/bookings/[id]/ics posture). This service assumes an authorized caller and
// only assembles data. Returns null when the equipment does not exist.
export async function buildEquipmentRecordsXlsx(
  equipmentId: string,
): Promise<EquipmentRecordsExport | null> {
  const [equipment, org] = await Promise.all([
    prisma.equipment.findUnique({ where: { id: equipmentId }, select: { id: true, name: true } }),
    prisma.organization.findFirst({ select: { timezone: true } }),
  ])
  if (!equipment) return null
  const timezone = org?.timezone ?? 'Asia/Singapore'

  // Full-history audit export: ALL booking statuses, no take caps. The UI's
  // listTrainingRecords() (cap 100) is deliberately untouched.
  const [bookings, certifications, trainings] = await Promise.all([
    prisma.booking.findMany({
      where: { equipmentId },
      orderBy: { startsAt: 'asc' },
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.certification.findMany({
      where: { equipmentId },
      orderBy: { grantedAt: 'asc' },
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.trainingRecord.findMany({
      where: { equipmentId },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { name: true, email: true } },
        trainedBy: { select: { name: true } },
      },
    }),
  ])

  // decidedById / grantedById are bare strings (no Prisma relation) — resolve
  // every name in ONE user query.
  const bareIds = [
    ...new Set([
      ...bookings.flatMap((b) => (b.decidedById ? [b.decidedById] : [])),
      ...certifications.map((c) => c.grantedById),
    ]),
  ]
  const names = new Map(
    bareIds.length
      ? (
          await prisma.user.findMany({
            where: { id: { in: bareIds } },
            select: { id: true, name: true },
          })
        ).map((u) => [u.id, u.name] as const)
      : [],
  )

  const wb = new ExcelJS.Workbook()
  wb.creator = 'LabHub'

  const bookingSheet = wb.addWorksheet('Bookings')
  bookingSheet.columns = [
    { header: 'When', key: 'when', width: 34 },
    { header: 'User', key: 'user', width: 22 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Purpose', key: 'purpose', width: 30 },
    { header: 'Session start', key: 'sessionStart', width: 22 },
    { header: 'Session end', key: 'sessionEnd', width: 22 },
    { header: 'Session note', key: 'sessionNote', width: 34 },
    { header: 'Decided by', key: 'decidedBy', width: 22 },
    { header: 'Decided at', key: 'decidedAt', width: 22 },
    { header: 'Rejection reason', key: 'rejectionReason', width: 30 },
  ]
  bookingSheet.addRows(
    bookings.map((b) => ({
      when: formatRange(b.startsAt, b.endsAt, timezone),
      user: b.user.name,
      email: b.user.email,
      status: b.status,
      purpose: b.purpose,
      sessionStart: b.sessionStartedAt ? formatDateTime(b.sessionStartedAt, timezone) : '',
      sessionEnd: b.sessionEndedAt ? formatDateTime(b.sessionEndedAt, timezone) : '',
      sessionNote: b.sessionNote,
      decidedBy: b.decidedById ? (names.get(b.decidedById) ?? '') : '',
      decidedAt: b.decidedAt ? formatDateTime(b.decidedAt, timezone) : '',
      rejectionReason: b.rejectionReason ?? '',
    })),
  )

  const trainingSheet = wb.addWorksheet('Training records')
  trainingSheet.columns = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Person', key: 'person', width: 22 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Trainer', key: 'trainer', width: 22 },
    { header: 'Note', key: 'note', width: 34 },
    { header: 'Recorded at', key: 'recordedAt', width: 22 },
  ]
  trainingSheet.addRows(
    trainings.map((t) => ({
      date: t.trainedOn,
      person: t.user.name,
      email: t.user.email,
      trainer: t.trainedBy.name,
      note: t.note,
      recordedAt: formatDateTime(t.createdAt, timezone),
    })),
  )

  const certSheet = wb.addWorksheet('Certifications')
  certSheet.columns = [
    { header: 'Person', key: 'person', width: 22 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Granted by', key: 'grantedBy', width: 22 },
    { header: 'Granted at', key: 'grantedAt', width: 22 },
  ]
  certSheet.addRows(
    certifications.map((c) => ({
      person: c.user.name,
      email: c.user.email,
      grantedBy: names.get(c.grantedById) ?? '',
      grantedAt: formatDateTime(c.grantedAt, timezone),
    })),
  )

  const body = Buffer.from(await wb.xlsx.writeBuffer())
  return { filename: exportFilename(equipment.name), body }
}
