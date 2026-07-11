'use server'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/session'
import { PolicyError } from '@/features/issues/issue-policy'
import * as issues from '@/features/issues/issue-service'
import * as projects from '@/features/issues/project-service'
import * as comments from '@/features/issues/comment-service'
import type { IssueStatus, IssuePriority, ProjectStatus } from '@prisma/client'

type Ok<T> = { ok: true } & T
type Result<T = object> = Ok<T> | { ok: false; message: string }

// Run a service call as the signed-in user, translating PolicyError to a message.
async function run<T>(fn: (u: { id: string; role: 'admin' | 'member' | 'guest' }) => Promise<T>): Promise<Result<{ data: T }>> {
  const u = await requireUser()
  try {
    const data = await fn(u)
    revalidatePath('/issues'); revalidatePath('/issues/me'); revalidatePath('/projects')
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
export async function createProjectAction(input: { name: string; description?: string; leadId?: string | null; targetDate?: string | null; status?: ProjectStatus }) {
  return run((u) => projects.createProject({ actorId: u.id, role: u.role, name: input.name, description: input.description, leadId: input.leadId ?? null, targetDate: input.targetDate ? new Date(input.targetDate) : null, status: input.status }))
}
export async function updateProjectAction(id: string, input: { name?: string; description?: string; leadId?: string | null; targetDate?: string | null; status?: ProjectStatus }) {
  return run((u) => projects.updateProject({ actorId: u.id, role: u.role, id, name: input.name, description: input.description, leadId: input.leadId, targetDate: input.targetDate ? new Date(input.targetDate) : (input.targetDate === null ? null : undefined), status: input.status }))
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
