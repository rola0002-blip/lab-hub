import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { orgToday } from '@/features/issues/due'
import { listTrainingRecords, listCertRevocations } from '@/features/certifications/service'
import Matrix from './matrix'
import History, { type LedgerRow } from './history'

export default async function CertificationsPage() {
  const me = await requireUser()
  if (me.role === 'guest') redirect('/dashboard')
  const [users, equipment, certs, myManaged, org, records, revocations] = await Promise.all([
    prisma.user.findMany({ where: { banned: false, isSystem: false }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } }),
    prisma.equipment.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.certification.findMany({ select: { userId: true, equipmentId: true } }),
    prisma.equipmentManager.findMany({ where: { userId: me.id }, select: { equipmentId: true } }),
    prisma.organization.findFirstOrThrow(),
    listTrainingRecords(),
    listCertRevocations(),
  ])
  const editable = me.role === 'admin' ? equipment.map((e) => e.id) : myManaged.map((m) => m.equipmentId)
  // today is computed ONCE on the server and threaded in (the due.ts convention) so
  // the dialog's default and the server's future-date check agree across hydration.
  const today = orgToday(new Date(), org.timezone)
  const trainers = users.filter((u) => u.role !== 'guest').map((u) => ({ id: u.id, name: u.name }))
  // ID-keyed (names are not unique across people+instruments): last trained date per
  // cell. W14-A: annulled records never claim "last trained" — a revoked record is
  // not evidence of current training.
  const lastTrained: Record<string, string> = {}
  for (const r of records) {
    if (r.revokedAt) continue
    const key = `${r.userId}:${r.equipmentId}`
    if (!lastTrained[key] || r.trainedOn > lastTrained[key]) lastTrained[key] = r.trainedOn
  }
  // W14-A: the unified ledger — training records + certification revocations, newest
  // first by each row's org-tz day (both yyyy-MM-dd, so the lexicographic compare is
  // exact — the lastTrained convention), with the row's timestamp as the same-day
  // tie-break so a 15:00 revocation lists above a 09:00 training recorded that day.
  const day = (r: LedgerRow) => (r.kind === 'training' ? r.trainedOn : r.revokedOn)
  const ts = (r: LedgerRow) => (r.kind === 'training' ? r.createdAt : r.revokedAt)
  const rows: LedgerRow[] = [
    ...records.map((r) => ({ ...r, kind: 'training' as const })),
    ...revocations.map((r) => ({ ...r, kind: 'revocation' as const })),
  ].sort((a, b) => (day(a) > day(b) ? -1 : day(a) < day(b) ? 1 : ts(a) < ts(b) ? 1 : -1))
  return (
    <div>
      <p className="text-sm font-medium text-subtle">02 — Certifications</p>
      <h1 className="mt-1 text-2xl font-semibold text-default">Certification matrix</h1>
      <Matrix users={users} equipment={equipment} certs={certs} editable={editable}
        today={today} trainers={trainers} me={{ id: me.id, name: me.name }} lastTrained={lastTrained} />
      {rows.length > 0 && <History rows={rows} editable={editable} />}
    </div>
  )
}
