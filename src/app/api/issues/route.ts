import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { listIssues, createIssue } from '@/features/issues/issue-service'
import { PolicyError, policyStatus } from '@/features/issues/issue-policy'

const STATUS_ENUM = z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELED'])
const PRIORITY_ENUM = z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'])

export async function GET(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const p = new URL(req.url).searchParams
  // Validate the enum query params (mirror the POST body validation): the previous
  // compile-time-only `as` cast let a bad `?status=FOO` reach the Prisma enum column
  // and throw → 500. An invalid enum value is a client error → 400. Free-form id
  // params (assignee/project/label) just match nothing, so they pass through.
  const filters = z.object({ status: STATUS_ENUM.optional(), priority: PRIORITY_ENUM.optional() })
    .safeParse({ status: p.get('status') ?? undefined, priority: p.get('priority') ?? undefined })
  if (!filters.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const issues = await listIssues({
    status: filters.data.status,
    assigneeId: p.get('assignee') ?? undefined,
    projectId: p.get('project') ?? undefined,
    labelId: p.get('label') ?? undefined,
    priority: filters.data.priority,
  })
  return NextResponse.json({ issues })
}

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = z.object({
    title: z.string().min(1).max(200), description: z.string().optional(),
    status: STATUS_ENUM.optional(),
    priority: PRIORITY_ENUM.optional(),
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
