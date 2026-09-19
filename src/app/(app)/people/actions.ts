'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
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
// The bot (isSystem) is load-bearing infrastructure — role flips or deactivation
// would orphan its messages, memberships and DMs. Same guard shape in both actions.
async function assertHumanTarget(userId: string): Promise<{ ok: false; message: string } | null> {
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { isSystem: true } })
  if (!target || target.isSystem) return { ok: false, message: 'System accounts cannot be modified.' }
  return null
}

export async function setRoleAction(userId: string, role: string): Promise<{ ok: boolean; message?: string }> {
  const admin = await requireAdmin()
  const r = roleSchema.safeParse(role)
  if (!r.success) return { ok: false, message: 'Enter a valid role.' }
  if (userId === admin.id) return { ok: false, message: 'You cannot change your own role.' }
  const rejected = await assertHumanTarget(userId)
  if (rejected) return rejected
  await setUserRole(userId, r.data); revalidatePath('/people')
  return { ok: true }
}
export async function deactivateAction(userId: string): Promise<{ ok: boolean; message?: string }> {
  const admin = await requireAdmin()
  if (userId === admin.id) return { ok: false, message: 'You cannot deactivate yourself.' }
  const rejected = await assertHumanTarget(userId)
  if (rejected) return rejected
  await deactivateUser(userId); revalidatePath('/people')
  return { ok: true }
}
export async function reactivateAction(userId: string) {
  await requireAdmin(); await reactivateUser(userId); revalidatePath('/people')
}
