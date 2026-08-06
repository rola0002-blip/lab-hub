'use server'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/session'
import { PolicyError, isFeedbackStatus } from '@/features/feedback/feedback-policy'
import * as feedback from '@/features/feedback/feedback-service'

type Result = { ok: true } | { ok: false; message: string }

// The files/actions.ts idiom EXACTLY: a PolicyError surfaces its own (human) message
// and anything else surfaces its message too — neither is rethrown, so the client
// always gets a toastable result instead of an unhandled Server Action rejection.
function fail(e: unknown): Result {
  if (e instanceof PolicyError) return { ok: false, message: e.message }
  return { ok: false, message: e instanceof Error ? e.message : 'Something went wrong.' }
}

export async function setFeedbackStatusAction(feedbackId: string, status: string): Promise<Result> {
  const u = await requireUser()
  // Validate the wire string here so the typed service parameter is never a lie
  // (the SP8 `weeks: 1 | 4` idiom). The service re-asserts both permission and status.
  if (!isFeedbackStatus(status)) return { ok: false, message: 'Invalid status.' }
  try { await feedback.setFeedbackStatus(u, feedbackId, status); revalidatePath('/feedback'); return { ok: true } } catch (e) { return fail(e) }
}

export async function deleteFeedbackAction(feedbackId: string): Promise<Result> {
  const u = await requireUser()
  try { await feedback.deleteFeedback(u, feedbackId); revalidatePath('/feedback'); return { ok: true } } catch (e) { return fail(e) }
}
