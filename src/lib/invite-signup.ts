import { AsyncLocalStorage } from 'node:async_hooks'

// Invitation token binding (v0.31.1 security patch). The auth before-hook gates signup
// on the email having a live PENDING invitation — which anyone who knows the invited
// address could satisfy directly. acceptInviteAction() re-validates the invite TOKEN
// server-side and wraps its internal signUpEmail in this context, so the hook can tell
// a token-validated acceptance apart from a direct, email-only claim. Mirrors the
// runAuthorizedBootstrap pattern in ./setup-token.ts (SP7 F1).

const inviteSignup = new AsyncLocalStorage<true>()

/**
 * Run `fn` inside the authorized-invite-signup context. Only the accept-invite server
 * action may enter this after getPendingInvitation(token) has re-validated the token.
 */
export function runAuthorizedInviteSignup<T>(fn: () => Promise<T>): Promise<T> {
  return inviteSignup.run(true, fn)
}

/** True only while executing inside runAuthorizedInviteSignup(); never leaks across async contexts. */
export function inAuthorizedInviteSignup(): boolean {
  return inviteSignup.getStore() === true
}
