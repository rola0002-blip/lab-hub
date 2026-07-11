import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { listIssues, createIssue } from '@/features/issues/issue-service'
import { PolicyError, policyStatus } from '@/features/issues/issue-policy'
import type { IssueStatus, IssuePriority } from '@prisma/client'

export async function GET(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const p = new URL(req.url).searchParams
  const issues = await listIssues({
    status: (p.get('status') as IssueStatus) ?? undefined,
    assigneeId: p.get('assignee') ?? undefined,
    projectId: p.get('project') ?? undefined,
    labelId: p.get('label') ?? undefined,
    priority: (p.get('priority') as IssuePriority) ?? undefined,
  })
  return NextResponse.json({ issues })
}

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = z.object({
    title: z.string().min(1).max(200), description: z.string().optional(),
    status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELED']).optional(),
    priority: z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    assigneeId: z.string().nullish(), projectId: z.string().nullish(),
    dueDate: z.string().nullish(), labelIds: z.array(z.string()).optional(), originMessageId: z.string().nullish(),
  }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  try {
    const d = parsed.data
    const issue = await createIssue({
      actorId: user.id, role: user.role, title: d.title, description: d.description,
      status: d.status, priority: d.priority, assigneeId: d.assigneeId ?? null, projectId: d.projectId ?? null,
      dueDate: d.dueDate ? new Date(d.dueDate) : null, labelIds: d.labelIds, originMessageId: d.originMessageId ?? null,
    })
    return NextResponse.json({ issue })
  } catch (e) {
    if (e instanceof PolicyError) return NextResponse.json({ error: e.message }, { status: policyStatus(e.code) })
    throw e
  }
}
