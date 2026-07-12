import { type ReactNode } from 'react'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { MessageSquareQuote } from 'lucide-react'
import { requireUser } from '@/lib/session'
import { prisma } from '@/lib/db'
import { parseIdentifier, extractIssueRefNumbers } from '@/features/issues/identifier'
import { getIssueDetail, listLabels } from '@/features/issues/issue-service'
import { resolveIssueRefs } from '@/features/issues/issue-ref-service'
import { listTimeline } from '@/features/issues/comment-service'
import { listProjects } from '@/features/issues/project-service'
import { isMember } from '@/features/chat/conversation-service'
import { IssueDetail } from '@/components/issues/issue-detail'

export default async function IssueDetailPage({ params }: { params: Promise<{ identifier: string }> }) {
  const user = await requireUser()
  const { identifier } = await params
  const n = parseIdentifier(identifier)
  if (n === null) notFound()
  const row = await prisma.issue.findUnique({ where: { number: n }, select: { id: true } })
  if (!row) notFound()
  const [detail, timeline, users, labels, projects] = await Promise.all([
    getIssueDetail(row.id), listTimeline(row.id),
    prisma.user.findMany({ where: { banned: false }, orderBy: { name: 'asc' }, select: { id: true, name: true, image: true } }),
    listLabels(), listProjects(),
  ])
  if (!detail) notFound()

  // Server-side ref resolution (spec §7.1): the same COL-<n> tokens work in the
  // description AND every comment. One query resolves them all; the client builds
  // the Map and threads it into renderTokens (accent pills, server-resolved).
  const refNumbers = [
    ...extractIssueRefNumbers(detail.issue.description),
    ...timeline.flatMap((e) => (e.kind === 'comment' ? extractIssueRefNumbers(e.comment.body) : [])),
  ]
  const issueRefs = await resolveIssueRefs(refNumbers)

  // Membership-gated origin backlink chip. The content was captured at creation by
  // a member who had access, so the chip is always shown — but it only LINKS back
  // to chat for current members; non-members see it unlinked (never widens chat
  // visibility). onDelete:SetNull means a deleted source message just drops the chip.
  let originChip: ReactNode = null
  if (detail.issue.originMessageId) {
    const origin = await prisma.message.findUnique({
      where: { id: detail.issue.originMessageId },
      select: { id: true, conversationId: true, conversation: { select: { name: true, type: true } } },
    })
    if (origin) {
      const where = origin.conversation.type === 'DM' ? 'a direct message' : `#${origin.conversation.name ?? 'channel'}`
      const canLink = await isMember(user.id, origin.conversationId) // links only for members; others see it unlinked
      const inner = <span className="inline-flex items-center gap-1"><MessageSquareQuote size={13} aria-hidden />From a message in {where}</span>
      originChip = (
        <div className="mt-1 text-xs text-muted">
          {canLink
            ? <Link href={`/chat/${origin.conversationId}?msg=${origin.id}`} className="rounded bg-active px-1.5 py-0.5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">{inner}</Link>
            : <span className="rounded bg-active px-1.5 py-0.5">{inner}</span>}
        </div>
      )
    }
  }

  return (
    <IssueDetail issue={detail.issue} attachments={detail.attachments} timeline={timeline} role={user.role} selfId={user.id}
      users={users} projects={projects.map((p) => ({ id: p.id, name: p.name }))} labels={labels} issueRefs={issueRefs} originChip={originChip} />
  )
}
