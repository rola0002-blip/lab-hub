import Link from 'next/link'
import { redirect } from 'next/navigation'
import { History as HistoryIcon } from 'lucide-react'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { orgToday, orgDate } from '@/features/issues/due'
import { listTrainingRecords, listCertRevocations } from '@/features/certifications/service'
import { listPendingRequests } from '@/features/certifications/training-request-service'
import { EmptyState } from '@/components/ui/empty-state'
import Matrix from './matrix'
import History, { type LedgerRow } from './history'
import Requests, { type RequestRowView } from './requests'

// The tab rail is URL state (the issues filter-bar idiom): shareable, back-button
// honest, and server-rendered per navigation. Unknown ?tab= values degrade to the
// default instead of erroring, and ?tab=requests from a non-manager degrades the
// same way — the service still owns the permission on every decide call.
type Tab = 'requests' | 'matrix' | 'history'
const TABS: { id: Tab; label: string }[] = [
  { id: 'matrix', label: 'Matrix' },
  { id: 'history', label: 'History' },
]

export default async function CertificationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await requireUser()
  if (me.role === 'guest') redirect('/dashboard')
  const { tab: rawTab } = await searchParams
  const [users, equipment, certs, myManaged, org, records, revocations] = await Promise.all([
    prisma.user.findMany({ where: { banned: false, isSystem: false }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } }),
    prisma.equipment.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.certification.findMany({ select: { userId: true, equipmentId: true } }),
    prisma.equipmentManager.findMany({ where: { userId: me.id }, select: { equipmentId: true } }),
    prisma.organization.findFirstOrThrow(),
    listTrainingRecords(),
    listCertRevocations(),
  ])
  // Requests is the managers/admins tab (the decide gate is isManagerOf, which
  // folds admins in) — a member who manages nothing never sees it.
  const canDecide = me.role === 'admin' || myManaged.length > 0
  const active: Tab = rawTab === 'history' ? 'history'
    : rawTab === 'requests' && canDecide ? 'requests'
    : 'matrix'
  // The pending queue loads only when its tab is the one being rendered (one
  // page, one panel); createdAt is rendered as an org-tz day, the ledger idiom.
  let requests: RequestRowView[] = []
  if (active === 'requests') {
    const rows = await listPendingRequests(me.id)
    requests = rows.map((r) => ({
      id: r.id, userName: r.userName, equipmentName: r.equipmentName,
      note: r.note, requestedOn: orgDate(r.createdAt, org.timezone),
    }))
  }
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

  // Link-tabs (URL state above): each tab is a link with the tab role, and the
  // panel carries aria-labelledby back — the rail reads as tabs to AT while
  // staying plain navigation.
  const tabHref = (id: Tab) => (id === 'matrix' ? '/certifications' : `/certifications?tab=${id}`)
  const rail = [
    ...(canDecide ? [{ id: 'requests' as Tab, label: 'Requests' }] : []),
    ...TABS,
  ]
  return (
    <div>
      <p className="text-sm font-medium text-subtle">02 — Certifications</p>
      <h1 className="mt-1 text-2xl font-semibold text-default">Certifications</h1>
      <div role="tablist" aria-label="Certifications" className="mt-4 flex flex-wrap gap-2">
        {rail.map((t) => (
          <Link key={t.id} id={`cert-tab-${t.id}`} role="tab" href={tabHref(t.id)} aria-selected={active === t.id}
            aria-controls="cert-panel"
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] ${
              active === t.id
                ? 'border-accent bg-accent/10 font-medium text-[var(--text-accent)]'
                : 'border-border text-default hover:bg-hover'
            }`}>
            {t.label}
          </Link>
        ))}
      </div>
      <div id="cert-panel" role="tabpanel" aria-labelledby={`cert-tab-${active}`}>
        {active === 'requests' && <Requests rows={requests} today={today} me={{ name: me.name }} />}
        {active === 'matrix' && (
          <Matrix users={users} equipment={equipment} certs={certs} editable={editable}
            today={today} trainers={trainers} me={{ id: me.id, name: me.name }} lastTrained={lastTrained} />
        )}
        {active === 'history' && (rows.length > 0
          ? <History rows={rows} editable={editable} />
          : <EmptyState icon={HistoryIcon} title="No training history yet"
              hint="Granted certifications and their training records will appear here." />)}
      </div>
    </div>
  )
}
