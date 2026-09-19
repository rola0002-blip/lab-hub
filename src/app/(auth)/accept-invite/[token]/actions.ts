'use server'
import { auth } from '@/lib/auth'
import { getPendingInvitation } from '@/features/invitations/service'
import { runAuthorizedInviteSignup } from '@/lib/invite-signup'

// Server-side token binding for invite acceptance (v0.31.1 security patch). The form
// never signs up via the public auth endpoint anymore: this action re-validates the
// token (never trusting a client-sent email) and creates the account inside the
// authorized-invite ALS context; the client then signs in, which is not invite-gated.
export async function acceptInviteAction(token: string, name: string, password: string): Promise<{ ok: boolean; message?: string }> {
  const inv = await getPendingInvitation(token)
  if (!inv) return { ok: false, message: 'This invitation is no longer valid. Ask an administrator to resend it.' }
  if (!name.trim()) return { ok: false, message: 'Enter your name.' }
  try {
    await runAuthorizedInviteSignup(() =>
      auth.api.signUpEmail({ body: { email: inv.email, name: name.trim(), password } }))
    return { ok: true }
  } catch (e) {
    return { ok: false, message: e instanceof Error && e.message ? e.message : 'Could not create account' }
  }
}
