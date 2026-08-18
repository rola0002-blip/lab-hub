import 'server-only'
import { prisma } from './db'
import { env } from './env'
import { notify } from './notify'
import { formatRange } from './time'
import { drainOutbox, enqueueEmail } from './email/outbox'
import { bookingReminderEmail, digestChatEmail } from './email/templates'
import { notificationHref } from './notification-href'
import { formatIdentifier } from '@/features/issues/identifier'
import { startOfOrgDay, orgToday } from '@/features/issues/due'
import { OPEN_STATUSES } from '@/features/issues/status'
import { promptAtFor, shouldPrompt, promptDigestLine } from '@/features/issues/update-prompt'
import { isEffectiveLead } from '@/features/issues/project-health'
import { isIssueStalled, STARTED_STATUSES } from '@/features/issues/stale'
import { lastTouchedByIssue } from '@/features/issues/issue-service'
import * as bot from '@/features/bot'

export async function expirePendingBookings(now: Date = new Date()): Promise<number> {
  const overdue = await prisma.booking.findMany({
    where: { status: 'PENDING', startsAt: { lte: now } },
    include: { equipment: { include: { managers: true } }, user: { select: { name: true } } },
  })
  if (overdue.length === 0) return 0
  await prisma.booking.updateMany({ where: { id: { in: overdue.map((b) => b.id) } }, data: { status: 'EXPIRED' } })
  const org = await prisma.organization.findFirst()
  const tz = org?.timezone ?? 'Asia/Singapore'
  for (const b of overdue) {
    const when = formatRange(b.startsAt, b.endsAt, tz)
    const msg = `Booking request for ${b.equipment.name} (${when}) expired without a decision.`
    await notify(b.userId, 'booking_expired', { message: msg })
    await Promise.all(b.equipment.managers.map((m) => notify(m.userId, 'booking_expired', { message: `${b.user.name}: ${msg}` })))
  }
  return overdue.length
}

export async function sendBookingReminders(now: Date = new Date()): Promise<number> {
  const soon = await prisma.booking.findMany({
    where: { status: 'CONFIRMED', reminderSentAt: null, startsAt: { gt: now, lte: new Date(now.getTime() + 60 * 60_000) } },
    include: { equipment: { select: { name: true } } },
  })
  if (soon.length === 0) return 0
  const org = await prisma.organization.findFirst()
  const tz = org?.timezone ?? 'Asia/Singapore'
  for (const b of soon) {
    const when = formatRange(b.startsAt, b.endsAt, tz)
    await notify(b.userId, 'booking_reminder', { message: `Upcoming: ${b.equipment.name} ${when}` },
      bookingReminderEmail(org?.name ?? 'LabHub', b.equipment.name, when))
    await bot.dmUser(b.userId, `Upcoming: ${b.equipment.name} ${when}.`, { suppress: true })
    await prisma.booking.update({ where: { id: b.id }, data: { reminderSentAt: now } })
  }
  return soon.length
}

export async function pingDueSoonIssues(now: Date = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() + 24 * 3_600_000)
  const due = await prisma.issue.findMany({
    where: {
      dueDate: { gte: now, lte: horizon }, dueSoonPingedAt: null,
      assigneeId: { not: null }, status: { notIn: ['DONE', 'CANCELED'] },
    },
    select: { id: true, number: true, title: true, assigneeId: true },
  })
  if (due.length === 0) return 0
  for (const i of due) {
    const id = formatIdentifier(i.number)
    await bot.dmUser(i.assigneeId!, `Heads up — ${id} "${i.title}" is due within 24 hours.`) // normal fan-out → single message_dm bell
    await prisma.issue.update({ where: { id: i.id }, data: { dueSoonPingedAt: now } })
  }
  return due.length
}

export async function pingOverdueIssues(now: Date = new Date()): Promise<number> {
  // "Overdue" = the due DAY has fully passed in the org zone — the SAME definition
  // as the row/card chip and the "overdue" quick filter (dueBucket / dueRange): the
  // cutoff is the start of today, so an issue due *today* is not nudged as overdue
  // (it gets the due-soon ping instead). One DM per issue on first crossing; the
  // overduePingedAt flag makes it one-shot and setDueDate() clears it to re-arm.
  const org = await prisma.organization.findFirst()
  const tz = org?.timezone ?? 'Asia/Singapore'
  const cutoff = startOfOrgDay(now, tz)
  const overdue = await prisma.issue.findMany({
    where: {
      dueDate: { lt: cutoff }, overduePingedAt: null,
      assigneeId: { not: null }, status: { notIn: ['DONE', 'CANCELED'] },
    },
    select: { id: true, number: true, title: true, assigneeId: true },
  })
  if (overdue.length === 0) return 0
  for (const i of overdue) {
    const id = formatIdentifier(i.number)
    // Same posture as due-soon: deliberately UNSUPPRESSED, so the normal DM fan-out
    // provides the single message_dm bell (there is no other native notification).
    await bot.dmUser(i.assigneeId!, `Overdue — ${id} "${i.title}" is past its due date.`)
    await prisma.issue.update({ where: { id: i.id }, data: { overduePingedAt: now } })
  }
  return overdue.length
}

// SP8: the weekly project-update prompt (spec §4.3–§4.5). Window predicate, not a
// bare interval: fires on the org's configured weekday once now >= promptAt (org
// tz, TZDate component construction), latching per project against THIS week's
// promptAt — a recurring latch, not the one-shot dueSoonPingedAt idiom. The SELECT
// deliberately does NOT filter on lead: recipient resolution (effective lead →
// open-issue assignees → admins) runs per project so unowned projects still reach
// their fallback. Delivery = suppressed bot DM + explicit NO-EMAIL notify() whose
// payload matches the chat fan-out shape — one bell, one DM row, zero outbox rows.
export async function promptProjectUpdates(now: Date = new Date()): Promise<number> {
  const org = await prisma.organization.findFirst()
  if (!org) return 0
  const tz = org.timezone ?? 'Asia/Singapore'
  const promptAt = promptAtFor(now, tz, org.updatePromptDay, org.updatePromptHour)
  if (!promptAt || now < promptAt) return 0

  const candidates = await prisma.project.findMany({
    where: { status: 'ACTIVE' },
    include: { lead: { select: { id: true, banned: true, isSystem: true, role: true } } },
  })
  const dueProjects = candidates.filter((p) => shouldPrompt({
    now, promptAt, lastUpdatePromptAt: p.lastUpdatePromptAt, pausedUntil: p.updatePromptsPausedUntil,
  }))
  if (dueProjects.length === 0) return 0

  const today = orgToday(now, tz)
  const HUMAN = { banned: false, isSystem: false, role: { not: 'guest' } } as const
  for (const p of dueProjects) {
    // Digest window = max(latest update, now − 7 days). deletedAt: null (v0.15 §6.2,
    // the fourth latest-update site, filtered by hand — this read wants only the
    // instant, so it needs neither the author join nor PROJECT_UPDATE_ORDER's
    // tiebreak): a retracted update must not shrink the window, or the work done
    // since the real last update would vanish from the digest.
    const latest = await prisma.projectUpdate.findFirst({ where: { projectId: p.id, deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000)
    const since = latest && latest.createdAt > weekAgo ? latest.createdAt : weekAgo
    const [closed, overdue, started] = await Promise.all([
      prisma.issue.count({ where: { projectId: p.id, status: 'DONE', completedAt: { gte: since } } }),
      prisma.issue.count({ where: { projectId: p.id, status: { in: OPEN_STATUSES }, dueDate: { lt: startOfOrgDay(now, tz) } } }),
      prisma.issue.findMany({ where: { projectId: p.id, status: { in: STARTED_STATUSES } }, select: { id: true, status: true } }),
    ])
    // "Touched" = max(activity, non-deleted comment) — never Issue.updatedAt (§5.2);
    // the same helper the stalled chip's lastTouchedAt is hydrated from.
    const touched = await lastTouchedByIssue(started.map((i) => i.id))
    const stalled = started.filter((i) => isIssueStalled(i.status, touched.get(i.id) ?? null, today, tz)).length
    const line = promptDigestLine({ projectName: p.name, projectId: p.id, since, closed, overdue, stalled, tz, appUrl: env.APP_URL })

    // Recipients: effective lead → distinct open-issue assignees → admins, all under
    // the same human filter (a banned recipient would make getOrCreateDm no-op silently).
    let recipients: string[] = isEffectiveLead(p.lead) ? [p.lead!.id] : []
    if (recipients.length === 0) {
      const assignees = await prisma.issue.findMany({
        where: { projectId: p.id, status: { in: OPEN_STATUSES }, assigneeId: { not: null }, assignee: HUMAN },
        select: { assigneeId: true }, distinct: ['assigneeId'],
      })
      recipients = assignees.map((a) => a.assigneeId!)
    }
    if (recipients.length === 0) {
      const admins = await prisma.user.findMany({ where: { role: 'admin', banned: false, isSystem: false }, select: { id: true } })
      recipients = admins.map((a) => a.id)
    }
    for (const uid of recipients) {
      const dm = await bot.dmUser(uid, line, { suppress: true })
      // Three arguments — omitting the fourth IS the no-email path. Payload shape is
      // byte-identical to the chat fan-out payload, so notificationHref resolves it
      // to /chat/<cid>?msg=<mid> with no resolver change.
      if (dm) await notify(uid, 'project_update_prompt', { message: line, conversationId: dm.conversationId, messageId: dm.messageId })
    }
    // Latch UNCONDITIONALLY, per project, post-DM: a zero-recipient project is
    // latched once and moves on; a mid-run crash leaves the remainder unlatched for
    // the next 300s tick — exactly once, no double prompt, no skip.
    await prisma.project.update({ where: { id: p.id }, data: { lastUpdatePromptAt: now } })
  }
  return dueProjects.length
}

// F8: one digest email per user per run for chat bells still unread after 60
// minutes. ≤1 digest per user per ~hour via the per-user 55-min emailedAt
// cooldown (the 300s interval alone cannot bound it — sliding window). Only
// rows whose payload carries a HUMAN senderId digest — bot DMs (due-soon,
// overdue, prompts) tell you something you already know, and pre-wave rows
// without senderId are skipped rather than guessed. emailedAt is the latch:
// stamped after enqueue, so a crash mid-user at worst double-sends one email
// once (the SP8 unconditional-latch posture).
export async function digestUnreadChat(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 60 * 60_000)
  const rows = await prisma.notification.findMany({
    where: {
      type: { in: ['message_mention', 'message_dm', 'message_thread_reply'] },
      readAt: null, emailedAt: null, createdAt: { lte: cutoff },
    },
    orderBy: { createdAt: 'asc' }, take: 1000,
  })
  if (rows.length === 0) return 0
  const senderOf = (r: (typeof rows)[number]) => (r.payload as { senderId?: unknown }).senderId
  const senderIds = [...new Set(rows.map(senderOf).filter((x): x is string => typeof x === 'string'))]
  let eligible: typeof rows = []
  if (senderIds.length > 0) {
    const senders = await prisma.user.findMany({ where: { id: { in: senderIds } }, select: { id: true, isSystem: true } })
    const human = new Set(senders.filter((s) => !s.isSystem).map((s) => s.id))
    eligible = rows.filter((r) => human.has(senderOf(r) as string))
  }
  if (eligible.length === 0) return 0
  const org = await prisma.organization.findFirst()
  const byUser = new Map<string, typeof eligible>()
  for (const r of eligible) {
    const arr = byUser.get(r.userId) ?? []
    arr.push(r); byUser.set(r.userId, arr)
  }
  let sent = 0
  for (const [userId, items] of byUser) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, banned: true } })
    if (!user || user.banned) continue
    // Cooldown: ≤1 digest per user per ~hour even under continuous arrival —
    // the 300s interval alone cannot provide it (sliding 60-min window). The
    // immediate-email latch (dmEmail etc.) also stamps emailedAt, so a user who
    // just got an immediate email is not digested minutes later (one-bell rule).
    const last = await prisma.notification.findFirst({
      where: { userId, emailedAt: { not: null }, type: { in: ['message_mention', 'message_dm', 'message_thread_reply'] } },
      orderBy: { emailedAt: 'desc' }, select: { emailedAt: true },
    })
    if (last && last.emailedAt && now.getTime() - last.emailedAt.getTime() < 55 * 60_000) continue
    const tpl = digestChatEmail(
      org?.name ?? 'LabHub',
      items.map((n) => ({
        message: String((n.payload as { message?: string }).message ?? 'New message'),
        href: notificationHref({ type: n.type, payload: n.payload as Record<string, string> }) ?? '/chat',
      })),
      env.APP_URL,
    )
    await enqueueEmail(user.email, tpl.subject, tpl.html)
    await prisma.notification.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { emailedAt: now } })
    sent++
  }
  return sent
}

export function startJobs(): void {
  if (env.DISABLE_JOBS) return
  const guard = (fn: () => Promise<unknown>) => {
    let running = false
    return async () => {
      if (running) return
      running = true
      try { await fn() } catch (e) { console.error('job failed', e) } finally { running = false }
    }
  }
  setInterval(guard(() => drainOutbox()), 60_000)
  setInterval(guard(() => expirePendingBookings()), 60_000)
  setInterval(guard(() => sendBookingReminders()), 300_000)
  setInterval(guard(() => pingDueSoonIssues()), 300_000)
  setInterval(guard(() => pingOverdueIssues()), 300_000)
  setInterval(guard(() => promptProjectUpdates()), 300_000)
  setInterval(guard(() => digestUnreadChat()), 300_000) // F8: unread-chat digest, ≤1 email/user/hour
}
