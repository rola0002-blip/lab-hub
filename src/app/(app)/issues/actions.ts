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
  // v0.15 §5.3 — same tri-state as leadId: an id links, null unlinks, undefined
  // (omitted on update) leaves the link alone. The service validates the id.
  documentFolderId: z.string().nullish(),
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
// F5 — project-scoped labels. Name shape checked here (the RPC-argument lesson:
// a forged non-string degrades to {ok:false,message}, never a 500); ids get the
// milestoneIdSchema treatment — a malformed id can never name a row. The service
// still owns permission, trim/cap, scope and the P2002 duplicate-name translation.
const labelNameSchema = z.string().trim().min(1, 'Label name must be 1–40 characters.').max(40, 'Label name must be 1–40 characters.')
const labelIdSchema = z.string().min(1)
const createLabelSchema = z.object({ name: labelNameSchema, projectId: z.string().min(1).nullish() })
export async function createLabelAction(name: string, projectId?: string | null) {
  const parsed = createLabelSchema.safeParse({ name, projectId: projectId ?? null })
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? 'Invalid label.' }
  const v = parsed.data
  return run((u) => issues.createLabel({ actorId: u.id, role: u.role, name: v.name, projectId: v.projectId ?? null }))
}
export async function renameLabelAction(labelId: string, name: string) {
  const id = labelIdSchema.safeParse(labelId)
  if (!id.success) return { ok: false as const, message: 'Label not found.' }
  const parsed = labelNameSchema.safeParse(name)
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? 'Invalid label.' }
  return run((u) => issues.renameLabel({ actorId: u.id, role: u.role, labelId: id.data, name: parsed.data }))
}
export async function deleteLabelAction(labelId: string) {
  const id = labelIdSchema.safeParse(labelId)
  if (!id.success) return { ok: false as const, message: 'Label not found.' }
  return run((u) => issues.deleteLabel({ actorId: u.id, role: u.role, labelId: id.data }).then(() => undefined))
}
export async function createProjectAction(input: { name: string; description?: string; leadId?: string | null; documentFolderId?: string | null; startDate?: string | null; targetDate?: string | null; status?: ProjectStatus }) {
  const parsed = createProjectSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, message: firstIssue(parsed.error) }
  const v = parsed.data
  return run((u) => projects.createProject({ actorId: u.id, role: u.role, name: v.name, description: v.description, leadId: v.leadId ?? null, documentFolderId: v.documentFolderId ?? null, startDate: toDate(v.startDate) ?? null, targetDate: toDate(v.targetDate) ?? null, status: v.status }))
}
export async function updateProjectAction(id: string, input: { name?: string; description?: string; leadId?: string | null; documentFolderId?: string | null; startDate?: string | null; targetDate?: string | null; status?: ProjectStatus }) {
  const parsed = updateProjectSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, message: firstIssue(parsed.error) }
  const v = parsed.data
  return run((u) => projects.updateProject({ actorId: u.id, role: u.role, id, name: v.name, description: v.description, leadId: v.leadId, documentFolderId: v.documentFolderId, startDate: toDate(v.startDate), targetDate: toDate(v.targetDate), status: v.status }))
}
export async function deleteProjectAction(id: string) {
  return run((u) => projects.deleteProject({ role: u.role, id }))
}
// F3 — pinned projects on /issues/me. Per-user state with NO role gate (guests may
// pin), so unlike every other project action above there is no assertCanMutate
// downstream — only existence and the MAX_PINS cap. The id is an RPC argument like
// any other (the updateIdSchema lesson): the `string` type is a compile-time claim
// only, and a forged non-string must degrade to {ok:false,message}, never a 500.
// A malformed id can never name a row, so it reads back as the service's own miss
// message. Distinct declaration from milestoneIdSchema because a project id is not
// a milestone id.
const pinProjectIdSchema = z.string().min(1)
export async function pinProjectAction(projectId: string) {
  const id = pinProjectIdSchema.safeParse(projectId)
  if (!id.success) return { ok: false as const, message: 'Project not found.' }
  return run((u) => projects.pinProject({ userId: u.id, projectId: id.data }).then(() => undefined))
}
export async function unpinProjectAction(projectId: string) {
  const id = pinProjectIdSchema.safeParse(projectId)
  if (!id.success) return { ok: false as const, message: 'Project not found.' }
  return run((u) => projects.unpinProject({ userId: u.id, projectId: id.data }).then(() => undefined))
}
// v0.12 §6.2 — the grid's arrangement move. The client sends only the neighbour
// ids the card sits between after the drop; the server mints the key. `.nullish()`
// keeps the boundary drops expressible (no prev = front, no next = end) while an
// empty-string id is rejected outright rather than silently read as a boundary.
const moveProjectSchema = z.object({
  projectId: z.string().min(1, 'Choose a project.'),
  prevId: z.string().min(1).nullish(),
  nextId: z.string().min(1).nullish(),
})
export async function moveProjectAction(input: { projectId: string; prevId: string | null; nextId: string | null }) {
  const parsed = moveProjectSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, message: firstIssue(parsed.error) }
  const v = parsed.data
  return run((u) => projects.moveProject({ actorId: u.id, role: u.role, projectId: v.projectId, prevId: v.prevId ?? null, nextId: v.nextId ?? null }))
}
// F4 — project milestones (dates + progress only). The shapes are checked here
// (v0.15 lessons: a Server Action is an RPC endpoint, so a forged non-string
// must degrade to {ok:false,message}, never a PrismaClientValidationError 500);
// the service still owns permission, existence and the not-found translation.
// The strip sends `date || null`, so '' never reaches these arms. No bot
// announce, no SSE — refresh is revalidatePath (run) + router.refresh() (the strip).
const milestoneNameSchema = z.string().trim().min(1, 'Milestone name must be 1–200 characters.').max(200, 'Milestone name must be 1–200 characters.')
// z.string().date() = calendar-valid yyyy-MM-dd (rejects 2026-13-45), the shape
// DATE_RE gates in the service — the belt to its suspenders.
const milestoneDateSchema = z.string().date('Milestone date must be a valid date.').nullable()
const createMilestoneSchema = z.object({ projectId: z.string().min(1), name: milestoneNameSchema, date: milestoneDateSchema })
const editMilestoneSchema = z.object({ milestoneId: z.string().min(1), name: milestoneNameSchema, date: milestoneDateSchema })
// Same shape as updateIdSchema, its own declaration because a milestone id is
// not an update id — a malformed id can never name a row, so it reads back as
// the service's own miss message.
const milestoneIdSchema = z.string().min(1)
export async function createMilestoneAction(projectId: string, name: string, date: string | null) {
  const parsed = createMilestoneSchema.safeParse({ projectId, name, date: date ?? null })
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? 'Invalid milestone.' }
  const v = parsed.data
  return run((u) => projects.createMilestone({ actorId: u.id, role: u.role, projectId: v.projectId, name: v.name, date: v.date }))
}
export async function editMilestoneAction(milestoneId: string, name: string, date: string | null) {
  const parsed = editMilestoneSchema.safeParse({ milestoneId, name, date: date ?? null })
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? 'Invalid milestone.' }
  const v = parsed.data
  return run((u) => projects.updateMilestone({ actorId: u.id, role: u.role, milestoneId: v.milestoneId, name: v.name, date: v.date }))
}
export async function toggleMilestoneAction(milestoneId: string) {
  const id = milestoneIdSchema.safeParse(milestoneId)
  if (!id.success) return { ok: false as const, message: 'Milestone not found.' }
  return run((u) => projects.toggleMilestone({ actorId: u.id, role: u.role, milestoneId: id.data }))
}
export async function deleteMilestoneAction(milestoneId: string) {
  const id = milestoneIdSchema.safeParse(milestoneId)
  if (!id.success) return { ok: false as const, message: 'Milestone not found.' }
  return run((u) => projects.deleteMilestone({ actorId: u.id, role: u.role, milestoneId: id.data }))
}
export async function deleteIssueAction(issueId: string) {
  return run((u) => issues.deleteIssue({ issueId, actorId: u.id, role: u.role }))
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
// v0.15 §6.3 — correction and retraction. The body/health shapes are postUpdateSchema's
// exactly (one contract whether the composer is writing or rewriting); there is no
// projectId term, because the update id names the row and the service re-derives both
// the project and the author from it — a forged projectId could never widen access.
const editUpdateSchema = postUpdateSchema.pick({ health: true, body: true })
// The id is an RPC argument like any other (the `weeks: 1 | 4` lesson below): the
// `string` type is a compile-time claim only, and a forged non-string reaches Prisma
// as-is — a PrismaClientValidationError, i.e. a 500, instead of the { ok:false, message }
// contract every other arm honours. A malformed id can never name a row, so it reads
// back as the service's own miss message rather than inventing a second phrasing.
const updateIdSchema = z.string().min(1)
export async function editProjectUpdateAction(updateId: string, input: { body: string; health: ProjectHealth }) {
  const id = updateIdSchema.safeParse(updateId)
  if (!id.success) return { ok: false as const, message: 'Update not found.' }
  const parsed = editUpdateSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? 'Invalid update.' }
  const v = parsed.data
  return run((u) => updates.editProjectUpdate({ updateId: id.data, actorId: u.id, role: u.role, health: v.health, body: v.body }))
}
export async function deleteProjectUpdateAction(updateId: string) {
  const id = updateIdSchema.safeParse(updateId)
  if (!id.success) return { ok: false as const, message: 'Update not found.' }
  return run((u) => updates.deleteProjectUpdate({ updateId: id.data, actorId: u.id, role: u.role }))
}
// `weeks: 1 | 4` is a compile-time claim only — a Server Action is an RPC endpoint,
// so the value must be re-checked at runtime. Unvalidated, a forged `1e9` hands
// nthPromptAfter a 7e9-iteration synchronous TZDate loop: an event-loop stall that
// takes the whole app down, not merely a 500 (SP8 review).
const weeksEnum = z.union([z.literal(1), z.literal(4)])
export async function pauseUpdatePromptsAction(projectId: string, weeks: 1 | 4) {
  const parsed = weeksEnum.safeParse(weeks)
  if (!parsed.success) return { ok: false as const, message: 'Invalid pause length.' }
  return run((u) => updates.pauseUpdatePrompts({ projectId, actorId: u.id, role: u.role, weeks: parsed.data }))
}
export async function resumeUpdatePromptsAction(projectId: string) {
  return run((u) => updates.resumeUpdatePrompts({ projectId, actorId: u.id, role: u.role }))
}
