import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import {
  getIssue, setTitle, updateDescription, setStatus, setPriority,
  setAssignee, setProject, setDueDate, setLabels, type IssueDto,
} from '@/features/issues/issue-service'
import { PolicyError, policyStatus } from '@/features/issues/issue-policy'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const issue = await getIssue(id)
  if (!issue) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ issue })
}

const STATUS_ENUM = z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELED'])
const PRIORITY_ENUM = z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'])
const patchBody = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  status: STATUS_ENUM.optional(),
  priority: PRIORITY_ENUM.optional(),
  assigneeId: z.string().nullish(),
  projectId: z.string().nullish(),
  dueDate: z.string().nullish(),
  labelIds: z.array(z.string()).optional(),
}).refine((d) => Object.keys(d).length > 0)

// Partial update mapped onto the existing setters (the same code the UI actions
// drive), applied title→description→priority→status→assignee→project→dueDate→
// labels so project-scoped label filtering sees the destination project. Each
// setter re-reads fresh; a final getIssue returns the combined result.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const parsed = patchBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const d = parsed.data
  try {
    const a = { actorId: user.id, role: user.role, issueId: id }
    if (d.title !== undefined) await setTitle({ ...a, title: d.title })
    if (d.description !== undefined) await updateDescription({ ...a, description: d.description })
    if (d.priority !== undefined) await setPriority({ ...a, priority: d.priority })
    if (d.status !== undefined) await setStatus({ ...a, status: d.status })
    if (d.assigneeId !== undefined) await setAssignee({ ...a, assigneeId: d.assigneeId ?? null })
    if (d.projectId !== undefined) await setProject({ ...a, projectId: d.projectId ?? null })
    if (d.dueDate !== undefined) await setDueDate({ ...a, dueDate: d.dueDate ? new Date(d.dueDate) : null })
    if (d.labelIds !== undefined) await setLabels({ ...a, labelIds: d.labelIds })
    const issue: IssueDto | null = await getIssue(id)
    if (!issue) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ issue })
  } catch (e) {
    if (e instanceof PolicyError) return NextResponse.json({ error: e.message }, { status: policyStatus(e.code) })
    throw e
  }
}
