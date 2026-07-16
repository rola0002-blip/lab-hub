import { timingSafeEqual } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'

// One-time bootstrap gate (SP7 F1). When SETUP_TOKEN is set, provisioning the first admin
// requires presenting the exact token, so an un-invited internet party cannot seize workspace
// admin during the window between the tunnel going live and the operator finishing setup.
// When SETUP_TOKEN is unset/blank the gate is disabled — Mac dev and existing deployments are
// unaffected (today's behaviour). The value is read from process.env at call time (it is also
// declared optional in src/lib/env.ts) so the gate reflects the live container value and both
// gate states are exercisable in tests.

const bootstrap = new AsyncLocalStorage<true>()

/** The configured bootstrap token, or undefined when the gate is disabled. */
function configuredToken(): string | undefined {
  const t = process.env.SETUP_TOKEN
  return t && t.length > 0 ? t : undefined
}

/** True when a SETUP_TOKEN gate is configured (bootstrap must present the token). */
export function setupTokenConfigured(): boolean {
  return configuredToken() !== undefined
}

/**
 * Constant-time check of a caller-presented token against SETUP_TOKEN.
 * Gate disabled (SETUP_TOKEN unset/blank) ⇒ always true (dev/local unaffected).
 */
export function setupTokenMatches(provided: string | undefined | null): boolean {
  const expected = configuredToken()
  if (expected === undefined) return true
  if (typeof provided !== 'string' || provided.length === 0) return false
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  // timingSafeEqual throws on length mismatch; guard first (length is not secret here).
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Run `fn` inside the authorized-bootstrap async context. completeSetup() wraps its internal
 * admin sign-up in this after validating the token, so the auth before-hook can tell the
 * operator's legitimate bootstrap sign-up apart from a direct, un-invited attacker sign-up.
 */
export function runAuthorizedBootstrap<T>(fn: () => Promise<T>): Promise<T> {
  return bootstrap.run(true, fn)
}

/** True only while executing inside runAuthorizedBootstrap(); never leaks across async contexts. */
export function inAuthorizedBootstrap(): boolean {
  return bootstrap.getStore() === true
}
