// Pure, testable construction of better-auth's per-endpoint rate-limit rules.
//
// The sign-in + sign-up bucket is deploy-tunable via `signInUpMax` (wired to
// AUTH_RATE_LIMIT_MAX in src/lib/auth.ts) because better-auth keys rate limits on the
// client IP, and the LAN beta publishes the app's Docker port straight to the network with
// no IP-preserving proxy — so every LAN client is SNAT'd to ONE Docker-gateway source IP
// and shares a single bucket. At the default 10/60 s that makes the throttle lab-wide: an
// onboarding burst of invitees, or one user fat-fingering a password, can 429 sign-in for
// everyone. Raising the limit on a trusted LAN restores usable throughput; per-IP identity
// is meaningless behind the published port anyway, and invitation-only sign-up keeps the
// surface bounded. This is NOT a switch to disable rate limiting — the limiter stays on.
//
// The password-reset bucket is left at its own fixed, lower rate: it is a distinct,
// lower-frequency path and not the shared-bucket availability concern the env knob targets.
export function authRateLimitRules(signInUpMax: number) {
  return {
    '/sign-in/email': { window: 60, max: signInUpMax },
    '/sign-up/email': { window: 60, max: signInUpMax },
    '/request-password-reset': { window: 300, max: 5 },
  }
}
