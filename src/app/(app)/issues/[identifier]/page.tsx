import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/session'
import { prisma } from '@/lib/db'
import { parseIdentifier } from '@/features/issues/identifier'
import { getIssueDetail, listLabels } from '@/features/issues/issue-service'
import { listTimeline } from '@/features/issues/comment-service'
import { listProjects } from '@/features/issues/project-service'
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
  return (
    <IssueDetail issue={detail.issue} attachments={detail.attachments} timeline={timeline} role={user.role} selfId={user.id}
      users={users} projects={projects.map((p) => ({ id: p.id, name: p.name }))} labels={labels} />
  )
}
