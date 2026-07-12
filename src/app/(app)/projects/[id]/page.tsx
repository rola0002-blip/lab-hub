import { ListTodo } from 'lucide-react'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/session'
import { prisma } from '@/lib/db'
import { getOrg } from '@/lib/org'
import { getProject } from '@/features/issues/project-service'
import { listIssues } from '@/features/issues/issue-service'
import { IssuesSurface } from '@/components/issues/issues-surface'
import { ProjectHeader } from '@/components/issues/project-header'
import { EmptyState } from '@/components/ui/empty-state'

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  const { id } = await params
  const [project, issues, users, org] = await Promise.all([
    getProject(id), listIssues({ projectId: id }),
    prisma.user.findMany({ where: { banned: false }, orderBy: { name: 'asc' }, select: { id: true, name: true, image: true } }),
    getOrg(),
  ])
  if (!project) notFound()
  const timezone = org?.timezone ?? 'Asia/Singapore'
  const empty = <EmptyState icon={ListTodo} title="No issues in this project yet" hint='Use "New issue" above — it pre-fills this project.' />
  return (
    <div className="space-y-5">
      <ProjectHeader project={project} role={user.role} users={users} />
      <IssuesSurface initial={issues} role={user.role} users={users} timezone={timezone} empty={empty} />
    </div>
  )
}
