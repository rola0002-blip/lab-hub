import Link from 'next/link'
import { CalendarDays, Files, FolderKanban, Inbox, MessagesSquare } from 'lucide-react'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { requireSetup } from '@/lib/org'
import { formatDateTime, formatRange } from '@/lib/time'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { DueDate } from '@/components/issues/due-date'
import { StalledChip } from '@/components/issues/stalled-chip'
import { BOOKING_VARIANT } from '@/features/booking/chip'
import { listIssues } from '@/features/issues/issue-service'
import { listProjects, type ProjectDto } from '@/features/issues/project-service'
import { listDocuments } from '@/features/documents/document-service'
import { dueBucket, orgToday, startOfOrgDay } from '@/features/issues/due'
import { OPEN_STATUSES } from '@/features/issues/status'
import { compareProjectsWorstFirst, healthBucket } from '@/features/issues/project-health'
import { isMember } from '@/features/chat/conversation-service'
import { LAB_UPDATES_CHANNEL_ID } from '@/features/bot'
import { messageToPlainText } from '@/features/chat/markdown'

// "Lab today" (SP8 §6): five FIXED sections — the same five whether or not they have
// content — so the page is a stable place to look rather than a layout that reshuffles.
// Read-only by construction: no composer, no menu, no form. Guests land here on a role
// rejection, so a mutation affordance added below would be a policy hole, not a feature.
const ATTENTION_ROWS = [
  { key: 'off_track', label: 'Off track' },
  { key: 'at_risk', label: 'At risk' },
  { key: 'no_lead', label: 'No lead' },
  { key: 'no_update', label: 'No update in 3 weeks' },
] as const

// Overdue first, then due-today, then upcoming, then undated; ties broken by the
// earlier due date. Purely presentational ordering over the SAME dueBucket the chips
// render from, so the row order can never contradict the chip beside it.
const BUCKET_RANK = { overdue: 0, today: 1, upcoming: 2 } as const

export default async function DashboardPage() {
  const me = await requireUser()
  const org = await requireSetup()
  const now = new Date()
  const tz = org.timezone
  // Org-day boundaries routed through due.ts — the dashboard can no longer disagree
  // with the overdue chip, the overdue nudge, or the project openOverdue counts.
  const today = orgToday(now, tz)
  const dayStart = startOfOrgDay(now, tz)
  const dayEnd = new Date(+dayStart + 86_400_000)

  const managedIds = me.role === 'admin'
    ? undefined
    : (await prisma.equipmentManager.findMany({ where: { userId: me.id }, select: { equipmentId: true } })).map((m) => m.equipmentId)

  const [mine, pendingCount, todayBookings, myIssuesRaw, projects, labMember, recentDocs] = await Promise.all([
    prisma.booking.findMany({
      where: { userId: me.id, status: { in: ['PENDING', 'CONFIRMED'] }, endsAt: { gte: now } },
      include: { equipment: { select: { name: true } } }, orderBy: { startsAt: 'asc' }, take: 5,
    }),
    me.role === 'guest' ? Promise.resolve(0) : prisma.booking.count({
      where: { status: 'PENDING', ...(managedIds ? { equipmentId: { in: managedIds } } : {}) },
    }),
    prisma.booking.findMany({
      where: { status: 'CONFIRMED', startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
      include: { equipment: { select: { name: true } }, user: { select: { name: true } } }, orderBy: { startsAt: 'asc' },
    }),
    listIssues({ assigneeId: me.id }),
    listProjects(),
    isMember(me.id, LAB_UPDATES_CHANNEL_ID),
    listDocuments({ take: 5 }),
  ])

  const myIssues = myIssuesRaw
    .filter((i) => OPEN_STATUSES.includes(i.status))
    .sort((a, b) => {
      const ra = a.dueDate ? BUCKET_RANK[dueBucket(a.dueDate, a.status, today, tz) ?? 'upcoming'] : 3
      const rb = b.dueDate ? BUCKET_RANK[dueBucket(b.dueDate, b.status, today, tz) ?? 'upcoming'] : 3
      return ra !== rb ? ra - rb : (a.dueDate ?? '') < (b.dueDate ?? '') ? -1 : 1
    })
    .slice(0, 8)

  // The attention buckets are derived from the SAME listProjects() read and the SAME
  // healthBucket predicate /projects?attention=1 filters on (ACTIVE, bucket !== on_track),
  // so the four counts always sum to exactly what the review screen lists.
  const buckets: Record<Exclude<ReturnType<typeof healthBucket>, 'on_track'>, ProjectDto[]> =
    { off_track: [], at_risk: [], no_lead: [], no_update: [] }
  for (const p of projects) {
    if (p.status !== 'ACTIVE') continue
    const b = healthBucket(p, today, tz)
    if (b !== 'on_track') buckets[b].push(p)
  }
  for (const k of ATTENTION_ROWS) buckets[k.key].sort((a, b) => compareProjectsWorstFirst(a, b, today, tz))
  const attentionTotal = ATTENTION_ROWS.reduce((n, k) => n + buckets[k.key].length, 0)

  // Chat visibility is ConversationMember, no exception: a non-member of #lab-updates
  // gets no query and no section — never a "you're not a member" placeholder, which
  // would itself leak that the channel has traffic.
  const labPosts = labMember
    ? await prisma.message.findMany({
        // kind:'user' is the codebase-wide "this row is CONTENT" gate (unread counting,
        // message-service.ts:229; the pane's own rendering, message-pane.tsx:346).
        // #lab-updates is a PUBLIC channel, so emitSystemRow (conversation-service.ts:24)
        // writes 'X joined'/'X was added' event rows into it via joinPublicChannel and
        // addMembers — parentId:null and deletedAt:null, so without this term they would
        // read as authored announcements and evict real posts from the top five.
        where: { conversationId: LAB_UPDATES_CHANNEL_ID, kind: 'user', parentId: null, deletedAt: null },
        orderBy: { createdAt: 'desc' }, take: 5,
        include: { user: { select: { name: true } }, _count: { select: { attachments: true } } },
      })
    : []
  // Resolve `<@id>` tokens to names for the preview line. One bounded read, and only
  // when a post actually mentions someone (bot announcements never do — §5.4).
  const mentionIds = [...new Set(labPosts.flatMap((m) => m.mentionUserIds))]
  const mentionNames = new Map(mentionIds.length
    ? (await prisma.user.findMany({ where: { id: { in: mentionIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name] as const)
    : [])

  const card = 'rounded-xl border border-border bg-surface p-4 shadow-xs'
  const footerLink = 'mt-3 block text-sm text-[var(--text-accent)] hover:underline'

  return (
    <div>
      <p className="text-sm font-medium text-subtle">01 — Dashboard</p>
      <h1 className="mt-1 text-2xl font-semibold text-default">Welcome, {me.name}</h1>

      {me.role !== 'guest' && pendingCount > 0 && (
        <Link href="/approvals"
          className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-4 text-sm font-medium text-default transition-colors hover:bg-[var(--color-warning)]/15">
          {pendingCount} booking request{pendingCount > 1 ? 's' : ''} waiting for approval →
        </Link>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* 1 — My issues: open work assigned to me, overdue first. */}
        <section className={card}>
          <h2 className="font-medium text-default">My issues</h2>
          {myIssues.length === 0 ? (
            <EmptyState icon={Inbox} title="Nothing assigned to you" hint="Issues assigned to you will appear here." />
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {myIssues.map((i) => (
                <li key={i.id}>
                  <Link href={`/issues/${i.identifier}`}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-hover">
                    <span className="shrink-0 text-2xs tabular-nums text-subtle">{i.identifier}</span>
                    <span className="min-w-0 flex-1 truncate text-default">{i.title}</span>
                    {/* Renders null unless started + untouched for STALE_ISSUE_DAYS. */}
                    <StalledChip status={i.status} lastTouchedAt={i.lastTouchedAt} today={today} timezone={tz} />
                    <span className="shrink-0 text-2xs tabular-nums">
                      <DueDate dueDate={i.dueDate} status={i.status} today={today} timezone={tz} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/issues/me" className={footerLink}>All my issues →</Link>
        </section>

        {/* 2 — Today in the lab, with my own upcoming bookings folded in on top. */}
        <section className={card}>
          <h2 className="font-medium text-default">Today in the lab</h2>
          {mine.length > 0 && (
            <>
              <h3 className="mt-3 text-2xs font-semibold uppercase tracking-wide text-subtle">Your next bookings</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {mine.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2 rounded-lg bg-selected px-2 py-1.5">
                    <span className="text-default">{b.equipment.name} · {formatRange(b.startsAt, b.endsAt, tz)}</span>
                    <Badge variant={BOOKING_VARIANT[b.status as keyof typeof BOOKING_VARIANT]}>{b.status.toLowerCase()}</Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
          {todayBookings.length > 0 ? (
            <>
              {/* Only when the sub-list above opened an h3: without this the whole-lab
                  list would sit inside the "Your next bookings" heading scope. */}
              {mine.length > 0 && <h3 className="mt-3 text-2xs font-semibold uppercase tracking-wide text-subtle">Everyone today</h3>}
              <ul className={`${mine.length > 0 ? 'mt-1' : 'mt-2'} space-y-1 text-sm`}>
                {todayBookings.map((b) => (
                  <li key={b.id} className="rounded-lg px-2 py-1.5 text-default transition-colors hover:bg-hover">
                    {b.user.name} — {b.equipment.name} · {formatRange(b.startsAt, b.endsAt, tz)}
                  </li>
                ))}
              </ul>
            </>
          ) : mine.length > 0 ? (
            <p className="mt-3 px-2 text-sm text-muted">Nothing else is scheduled today.</p>
          ) : (
            <EmptyState icon={CalendarDays} title="A quiet day"
              hint="No bookings are scheduled today — enjoy the calm or grab a slot."
              action={<Link href="/booking" className="text-sm font-medium text-[var(--text-accent)] hover:underline">Reserve an instrument →</Link>} />
          )}
          <Link href="/booking/day" className={footerLink}>Full day view →</Link>
        </section>

        {/* 3 — Projects needing attention: four fixed rows, counts that agree with
            /projects?attention=1 by construction (same read, same predicate). */}
        <section className={card}>
          <h2 className="font-medium text-default">Projects needing attention</h2>
          {attentionTotal === 0 ? (
            <EmptyState icon={FolderKanban} title="All projects on track" hint="Nothing needs attention right now." />
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {ATTENTION_ROWS.map(({ key, label }) => (
                <li key={key} className="flex items-baseline gap-3 rounded-lg px-2 py-1.5">
                  <span className="w-44 shrink-0 text-default">{label}</span>
                  <span className="shrink-0 font-medium tabular-nums text-default">{buckets[key].length}</span>
                  <span className="min-w-0 flex-1 truncate text-subtle">
                    {buckets[key].slice(0, 2).map((p) => p.name).join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/projects?attention=1" className={footerLink}>Review these projects →</Link>
        </section>

        {/* 4 — #lab-updates digest. Rendered ONLY for channel members. */}
        {labMember && (
          <section className={card}>
            <h2 className="font-medium text-default">Latest in #lab-updates</h2>
            {labPosts.length === 0 ? (
              <EmptyState icon={MessagesSquare} title="No lab updates yet" hint="Announcements posted to #lab-updates will appear here." />
            ) : (
              <ul className="mt-2 space-y-0.5">
                {labPosts.map((m) => (
                  <li key={m.id}>
                    <Link href={`/chat/${LAB_UPDATES_CHANNEL_ID}?msg=${m.id}`}
                      className="block rounded-lg px-2 py-1.5 transition-colors hover:bg-hover">
                      <span className="flex flex-wrap items-baseline gap-x-2 text-2xs text-subtle">
                        <span className="font-medium text-muted">{m.user.name}</span>
                        <span>{formatDateTime(m.createdAt, tz)}</span>
                        {m._count.attachments > 0 && <span>· {m._count.attachments} file{m._count.attachments > 1 ? 's' : ''}</span>}
                      </span>
                      {/* Plain text, never rendered markdown: a glance preview, two lines max. */}
                      <span className="mt-0.5 line-clamp-2 text-sm text-muted">
                        {messageToPlainText(m.body, (id) => mentionNames.get(id))}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link href={`/chat/${LAB_UPDATES_CHANNEL_ID}`} className={footerLink}>Open #lab-updates →</Link>
          </section>
        )}

        {/* 5 — Recent files (every role, guests included: browse is open by policy). */}
        <section className={`${card} lg:col-span-2`}>
          <h2 className="font-medium text-default">Recent files</h2>
          {recentDocs.length === 0 ? (
            <EmptyState icon={Files} title="No files yet" hint="Files your lab uploads will appear here." />
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {recentDocs.map((d) => (
                <li key={d.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-hover">
                  {/* pdf/image open inline, office files download — the serving route
                      sets Content-Disposition, so one anchor covers both. */}
                  <a href={d.path} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-default hover:underline">{d.name}</a>
                  <span className="hidden w-32 shrink-0 truncate text-subtle sm:block">{d.folderName ?? '—'}</span>
                  <span className="hidden w-40 shrink-0 truncate text-muted md:block">{d.uploaderName}</span>
                  <span className="hidden w-44 shrink-0 truncate text-subtle lg:block">{formatDateTime(d.createdAt, tz)}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/files" className={footerLink}>All files →</Link>
        </section>
      </div>
    </div>
  )
}
