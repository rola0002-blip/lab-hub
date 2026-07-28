import { ListTodo } from 'lucide-react'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/session'
import { prisma } from '@/lib/db'
import { getOrg } from '@/lib/org'
import { getProject } from '@/features/issues/project-service'
import { listProjectUpdates } from '@/features/issues/project-update-service'
import { listIssues } from '@/features/issues/issue-service'
import { extractIssueRefNumbers } from '@/features/issues/identifier'
import { resolveIssueRefs } from '@/features/issues/issue-ref-service'
import { accessibleConversationIds } from '@/features/chat/conversation-service'
import { orgToday } from '@/features/issues/due'
import { IssuesSurface } from '@/components/issues/issues-surface'
import { ProjectHeader } from '@/components/issues/project-header'
import { ProjectUpdates } from '@/components/issues/project-updates'
import { EmptyState } from '@/components/ui/empty-state'

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  const { id } = await params
  const [project, issues, updates, users, org] = await Promise.all([
    getProject(id), listIssues({ projectId: id }), listProjectUpdates(id),
    prisma.user.findMany({ where: { banned: false, isSystem: false }, orderBy: { name: 'asc' }, select: { id: true, name: true, image: true } }),
    getOrg(),
  ])
  if (!project) notFound()
  const timezone = org?.timezone ?? 'Asia/Singapore'
  const today = orgToday(new Date(), timezone) // org-day reference threaded to the due chips + the header health chip

  // Server-side ref resolution (spec §7.1), the issue-detail idiom: the same
  // LAB-<n> tokens work in every update body. One query resolves them all; the
  // client builds the Map and threads it into renderTokens.
  const issueRefs = await resolveIssueRefs(updates.flatMap((u) => extractIssueRefNumbers(u.body)))

  // Membership-gated origin backlink chips (one per update captured from chat).
  // The content was captured by a member who had access, so the chip always shows
  // — but it only LINKS back for CURRENT members; non-members see it unlinked
  // (never widens chat visibility). onDelete:SetNull means a deleted source
  // message just drops the chip. Batched (2 reads, not 2 per update).
  const originIds = [...new Set(updates.map((u) => u.originMessageId).filter((v): v is string => v !== null))]
  const origins: Record<string, { where: string; href: string | null }> = {}
  if (originIds.length > 0) {
    const [messages, memberOf] = await Promise.all([
      prisma.message.findMany({
        where: { id: { in: originIds } },
        select: { id: true, conversationId: true, conversation: { select: { name: true, type: true } } },
      }),
      accessibleConversationIds(user.id).then((ids) => new Set(ids)), // the ConversationMember gate, read once
    ])
    const byId = new Map(messages.map((m) => [m.id, m]))
    for (const u of updates) {
      const origin = u.originMessageId ? byId.get(u.originMessageId) : undefined
      if (!origin) continue
      const where = origin.conversation.type === 'DM' ? 'a direct message' : `#${origin.conversation.name ?? 'channel'}`
      origins[u.id] = { where, href: memberOf.has(origin.conversationId) ? `/chat/${origin.conversationId}?msg=${origin.id}` : null }
    }
  }

  const empty = <EmptyState icon={ListTodo} title="No issues in this project yet" hint='Use "New issue" above — it pre-fills this project.' />
  return (
    <div className="space-y-5">
      <ProjectHeader project={project} role={user.role} users={users} timezone={timezone} today={today} />
      <ProjectUpdates updates={updates} users={users} issueRefs={issueRefs} origins={origins} role={user.role} projectId={project.id} timezone={timezone} />
      <IssuesSurface initial={issues} role={user.role} users={users} timezone={timezone} today={today} empty={empty} />
    </div>
  )
}
