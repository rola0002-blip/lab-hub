import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { orgToday } from '@/features/issues/due'
import { listTrainingRecords } from '@/features/certifications/service'
import Matrix from './matrix'

export default async function CertificationsPage() {
  const me = await requireUser()
  if (me.role === 'guest') redirect('/dashboard')
  const [users, equipment, certs, myManaged, org, records] = await Promise.all([
    prisma.user.findMany({ where: { banned: false, isSystem: false }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } }),
    prisma.equipment.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.certification.findMany({ select: { userId: true, equipmentId: true } }),
    prisma.equipmentManager.findMany({ where: { userId: me.id }, select: { equipmentId: true } }),
    prisma.organization.findFirstOrThrow(),
    listTrainingRecords(),
  ])
  const editable = me.role === 'admin' ? equipment.map((e) => e.id) : myManaged.map((m) => m.equipmentId)
  // today is computed ONCE on the server and threaded in (the due.ts convention) so
  // the dialog's default and the server's future-date check agree across hydration.
  const today = orgToday(new Date(), org.timezone)
  const trainers = users.filter((u) => u.role !== 'guest').map((u) => ({ id: u.id, name: u.name }))
  // ID-keyed (names are not unique across people+instruments): last trained date per cell.
  const lastTrained: Record<string, string> = {}
  for (const r of records) {
    const key = `${r.userId}:${r.equipmentId}`
    if (!lastTrained[key] || r.trainedOn > lastTrained[key]) lastTrained[key] = r.trainedOn
  }
  return (
    <div>
      <p className="text-sm font-medium text-subtle">02 — Certifications</p>
      <h1 className="mt-1 text-2xl font-semibold text-default">Certification matrix</h1>
      <Matrix users={users} equipment={equipment} certs={certs} editable={editable}
        today={today} trainers={trainers} me={{ id: me.id, name: me.name }} lastTrained={lastTrained} />
      {records.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-default">Training history</h2>
          <div className="mt-2 overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-subtle">
                  <th className="p-2">Date</th><th className="p-2">Person</th><th className="p-2">Instrument</th>
                  <th className="p-2">Trainer</th><th className="p-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap p-2 text-default">{r.trainedOn}</td>
                    <td className="p-2 text-default">{r.userName}</td>
                    <td className="p-2 text-default">{r.equipmentName}</td>
                    <td className="p-2 text-default">{r.trainerName}</td>
                    <td className="p-2 text-muted">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
