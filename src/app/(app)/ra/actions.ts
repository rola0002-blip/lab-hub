'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/session'
import { PolicyError } from '@/features/ra/ra-policy'
import { submitRaAcknowledgments, revokeRaAcknowledgment } from '@/features/ra/ra-service'

type SubmitResult = { ok: true; recorded: number } | { ok: false; message: string }
type Result = { ok: true } | { ok: false; message: string }

// A Server Action is an RPC endpoint — zod-guard the wire args so a forged
// payload degrades to {ok:false,message}, never a PrismaClientValidationError
// 500 (the certifications-actions idiom).
const submitSchema = z.object({
  documentIds: z.array(z.string().min(1)).min(1, 'Pick at least one RA document.').max(100, 'Pick at most 100 RA documents.'),
  matricNumber: z.string().min(1).max(32),
})

function fail(e: unknown): { ok: false; message: string } {
  if (e instanceof PolicyError) return { ok: false, message: e.message }
  return { ok: false, message: e instanceof Error ? e.message : 'Something went wrong.' }
}

export async function submitRaAction(documentIds: string[], matricNumber: string): Promise<SubmitResult> {
  const parsed = submitSchema.safeParse({ documentIds, matricNumber })
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid acknowledgment.' }
  const u = await requireUser()
  try {
    const { recorded } = await submitRaAcknowledgments(u, parsed.data)
    revalidatePath('/ra')
    return { ok: true, recorded }
  } catch (e) { return fail(e) }
}

export async function revokeRaAction(id: string): Promise<Result> {
  const u = await requireUser()
  try { await revokeRaAcknowledgment(u, id); revalidatePath('/ra'); return { ok: true } } catch (e) { return fail(e) }
}
