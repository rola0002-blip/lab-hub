'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/session'
import { PolicyError } from '@/features/issues/issue-policy'
import * as issues from '@/features/issues/issue-service'
import * as projects from '@/features/issues/project-service'
import * as comments from '@/features/issues/comment-service'
import * as updates from '@/features/issues/project-update-service'
import type { IssueStatus, IssuePriority, ProjectStatus, ProjectHealth } from '@prisma/client'

type Ok<T> = { ok: true } & T
type Result<T = object> = Ok<T> | { ok: false; message: string }

// Zod-validated project inputs. Dates arrive from the composer's <input type=date>
// as calendar strings (YYYY-MM-DD) or null (cleared); a bad shape is rejected before
// the service runs. `.nullish()` on the dates keeps the tri-state the composer relies
// on: a string sets it, null clears it, undefined (create) / omission (update) leaves
// it. The start<=target ordering itself is enforced in project-service, not here.
const projectDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.').nullish()
const projectStatus = z.enum(['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELED'])
const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'Enter a project name.').max(120, 'Project name must be 1–120 characters.'),
  description: z.string().max(4000).optional(),
  leadId: z.string().nullish(),
  startDate: projectDate,
  targetDate: projectDate,
  status: projectStatus.optional(),
})
const updateProjectSchema = createProjectSchema.partial()
// string → Date; null → null (clear); undefined → undefined (leave untouched).
const toDate = (s: string | null | undefined): Date | null | undefined => (s ? new Date(s) : s === null ? null : undefined)
const firstIssue = (e: z.ZodError): string => e.issues[0]?.message ?? 'Invalid project.'

// Run a service call as the signed-in user, translating PolicyError to a message.
async function run<T>(fn: (u: { id: string; role: 'admin' | 'member' | 'guest' }) => Promise<T>): Promise<Result<{ data: T }>> {
  const u = await requireUser()
  try {
    const data = await fn(u)
    // Every covered mutation now feeds a dashboard section (SP8 §4.7) — one line, one place.
    revalidatePath('/issues'); revalidatePath('/issues/me'); revalidatePath('/projects'); revalidatePath('/dashboard')
    return { ok: true, data }
  } catch (e) {
    if (e instanceof PolicyError) return { ok: false, message: e.message }
    throw e
  }
}

export async function createIssueAction(input: {
  title: string; description?: string; status?: IssueStatus; priority?: IssuePriority
  assigneeId?: string | null; projectId?: string | null; dueDate?: string | null; labelIds?: string[]; originMessageId?: string | null
}) {
  return run((u) => issues.createIssue({
    actorId: u.id, role: u.role, title: input.title, description: input.description,
    status: input.status, priority: input.priority, assigneeId: input.assigneeId ?? null,
    projectId: input.projectId ?? null, dueDate: input.dueDate ? new Date(input.dueDate) : null,
    labelIds: input.labelIds, originMessageId: input.originMessageId ?? null,
  }))
}
export async function setStatusAction(issueId: string, status: IssueStatus) {
  return run((u) => issues.setStatus({ actorId: u.id, role: u.role, issueId, status }))
}
export async function setAssigneeAction(issueId: string, assigneeId: string | null) {
  return run((u) => issues.setAssignee({ actorId: u.id, role: u.role, issueId, assigneeId }))
}
export async function setPriorityAction(issueId: string, priority: IssuePriority) {
  return run((u) => issues.setPriority({ actorId: u.id, role: u.role, issueId, priority }))
}
export async function setProjectAction(issueId: string, projectId: string | null) {
  return run((u) => issues.setProject({ actorId: u.id, role: u.role, issueId, projectId }))
}
export async function setDueDateAction(issueId: string, dueDate: string | null) {
  return run((u) => issues.setDueDate({ actorId: u.id, role: u.role, issueId, dueDate: dueDate ? new Date(dueDate) : null }))
}
export async function setTitleAction(issueId: string, title: string) {
  return run((u) => issues.setTitle({ actorId: u.id, role: u.role, issueId, title }))
}
export async function setLabelsAction(issueId: string, labelIds: string[]) {
  return run((u) => issues.setLabels({ actorId: u.id, role: u.role, issueId, labelIds }))
}
export async function updateDescriptionAction(issueId: string, description: string) {
  return run((u) => issues.updateDescription({ actorId: u.id, role: u.role, issueId, description }))
}
export async function createLabelAction(name: string, color: string) {
  return run((u) => issues.createLabel({ actorId: u.id, role: u.role, name, color }))
}
export async function createProjectAction(input: { name: string; description?: string; leadId?: string | null; startDate?: string | null; targetDate?: string | null; status?: ProjectStatus }) {
  const parsed = createProjectSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, message: firstIssue(parsed.error) }
  const v = parsed.data
  return run((u) => projects.createProject({ actorId: u.id, role: u.role, name: v.name, description: v.description, leadId: v.leadId ?? null, startDate: toDate(v.startDate) ?? null, targetDate: toDate(v.targetDate) ?? null, status: v.status }))
}
export async function updateProjectAction(id: string, input: { name?: string; description?: string; leadId?: string | null; startDate?: string | null; targetDate?: string | null; status?: ProjectStatus }) {
  const parsed = updateProjectSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, message: firstIssue(parsed.error) }
  const v = parsed.data
  return run((u) => projects.updateProject({ actorId: u.id, role: u.role, id, name: v.name, description: v.description, leadId: v.leadId, startDate: toDate(v.startDate), targetDate: toDate(v.targetDate), status: v.status }))
}
export async function deleteProjectAction(id: string) {
  return run((u) => projects.deleteProject({ role: u.role, id }))
}
export async function createCommentAction(issueId: string, body: string) {
  return run((u) => comments.createComment({ actorId: u.id, role: u.role, issueId, body }))
}
export async function editCommentAction(commentId: string, body: string) {
  return run((u) => comments.editComment({ actorId: u.id, role: u.role, commentId, body }))
}
export async function deleteCommentAction(commentId: string) {
  return run((u) => comments.deleteComment({ actorId: u.id, role: u.role, commentId }))
}
export async function attachIssueFilesAction(issueId: string, files: { path: string; name: string; mime: string; size: number }[]) {
  return run((u) => issues.attachIssueFiles({ actorId: u.id, role: u.role, issueId, files }))
}

// SP8 §4.6 — weekly project updates. The composer's shape is validated here (the
// health enum never reaches a Prisma enum column unchecked); the service still owns
// permission, trim/cap and the forged-originMessageId guard.
const healthEnum = z.enum(['ON_TRACK', 'AT_RISK', 'OFF_TRACK'])
const postUpdateSchema = z.object({
  projectId: z.string().min(1, 'Choose a project.'),
  health: healthEnum,
  body: z.string().min(1, 'An update needs a few words.').max(4000),
  originMessageId: z.string().nullish(),
})
export async function postProjectUpdateAction(input: { projectId: string; health: ProjectHealth; body: string; originMessageId?: string | null }) {
  const parsed = postUpdateSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? 'Invalid update.' }
  const v = parsed.data
  return run((u) => updates.postProjectUpdate({ projectId: v.projectId, actorId: u.id, role: u.role, health: v.health, body: v.body, originMessageId: v.originMessageId ?? null }))
}
export async function pauseUpdatePromptsAction(projectId: string, weeks: 1 | 4) {
  return run((u) => updates.pauseUpdatePrompts({ projectId, actorId: u.id, role: u.role, weeks }))
}
export async function resumeUpdatePromptsAction(projectId: string) {
  return run((u) => updates.resumeUpdatePrompts({ projectId, actorId: u.id, role: u.role }))
}
