'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/session'
import { createInvitation, revokeInvitation, resendInvitation, acceptInviteUrl } from '@/features/invitations/service'
import { deactivateUser, reactivateUser, setUserRole } from '@/features/people/service'

const roleSchema = z.enum(['admin', 'member', 'guest'])

export async function inviteAction(email: string, role: string): Promise<{ ok: boolean; message?: string; url?: string }> {
  const admin = await requireAdmin()
  const r = roleSchema.safeParse(role)
  const e = z.string().email().safeParse(email.trim())
  if (!r.success || !e.success) return { ok: false, message: 'Enter a valid email and role.' }
  try {
    const { token } = await createInvitation(e.data, r.data, admin.id)
    revalidatePath('/people')
    return { ok: true, url: acceptInviteUrl(token) }
  } catch (err) {
    if (err instanceof Error && err.message === 'already_exists') return { ok: false, message: 'That email already has an account or a pending invitation.' }
    throw err
  }
}

export async function revokeInviteAction(id: string) {
  await requireAdmin(); await revokeInvitation(id); revalidatePath('/people')
}
export async function resendInviteAction(id: string) {
  await requireAdmin(); await resendInvitation(id); revalidatePath('/people')
}
export async function setRoleAction(userId: string, role: string) {
  const admin = await requireAdmin()
  const r = roleSchema.parse(role)
  if (userId === admin.id) return
  await setUserRole(userId, r); revalidatePath('/people')
}
export async function deactivateAction(userId: string) {
  const admin = await requireAdmin()
  if (userId === admin.id) return
  await deactivateUser(userId); revalidatePath('/people')
}
export async function reactivateAction(userId: string) {
  await requireAdmin(); await reactivateUser(userId); revalidatePath('/people')
}
