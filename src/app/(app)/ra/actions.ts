'use server'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/session'
import { PolicyError } from '@/features/ra/ra-policy'
import { submitRaAcknowledgment, revokeRaAcknowledgment } from '@/features/ra/ra-service'

type Result = { ok: true } | { ok: false; message: string }

function fail(e: unknown): Result {
  if (e instanceof PolicyError) return { ok: false, message: e.message }
  return { ok: false, message: e instanceof Error ? e.message : 'Something went wrong.' }
}

export async function submitRaAction(documentId: string, matricNumber: string): Promise<Result> {
  const u = await requireUser()
  try { await submitRaAcknowledgment(u, { documentId, matricNumber }); revalidatePath('/ra'); return { ok: true } } catch (e) { return fail(e) }
}

export async function revokeRaAction(id: string): Promise<Result> {
  const u = await requireUser()
  try { await revokeRaAcknowledgment(u, id); revalidatePath('/ra'); return { ok: true } } catch (e) { return fail(e) }
}
