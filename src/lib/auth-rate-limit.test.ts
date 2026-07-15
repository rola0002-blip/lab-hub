import { describe, it, expect } from 'vitest'
import { authRateLimitRules } from './auth-rate-limit'
import { parseEnv } from './env'

const base = { DATABASE_URL: 'postgresql://x', BETTER_AUTH_SECRET: 'x'.repeat(32) }

describe('authRateLimitRules', () => {
  it('defaults the sign-in + sign-up bucket to 10/60s when AUTH_RATE_LIMIT_MAX is unset', () => {
    const env = parseEnv(base)
    expect(env.AUTH_RATE_LIMIT_MAX).toBe(10) // safe default preserved (dev/e2e behaviour)
    const rules = authRateLimitRules(env.AUTH_RATE_LIMIT_MAX)
    expect(rules['/sign-in/email']).toEqual({ window: 60, max: 10 })
    expect(rules['/sign-up/email']).toEqual({ window: 60, max: 10 })
  })

  it('the AUTH_RATE_LIMIT_MAX env override flows into the sign-in + sign-up rules', () => {
    const env = parseEnv({ ...base, AUTH_RATE_LIMIT_MAX: '100' })
    expect(env.AUTH_RATE_LIMIT_MAX).toBe(100) // coerced string → number
    const rules = authRateLimitRules(env.AUTH_RATE_LIMIT_MAX)
    expect(rules['/sign-in/email'].max).toBe(100)
    expect(rules['/sign-up/email'].max).toBe(100)
  })

  it('leaves the password-reset bucket fixed at 5/300s regardless of the override', () => {
    expect(authRateLimitRules(10)['/request-password-reset']).toEqual({ window: 300, max: 5 })
    expect(authRateLimitRules(100)['/request-password-reset']).toEqual({ window: 300, max: 5 })
  })

  it('rejects a non-positive / non-numeric AUTH_RATE_LIMIT_MAX at parse time', () => {
    expect(() => parseEnv({ ...base, AUTH_RATE_LIMIT_MAX: '0' })).toThrow(/AUTH_RATE_LIMIT_MAX/)
    expect(() => parseEnv({ ...base, AUTH_RATE_LIMIT_MAX: 'lots' })).toThrow(/AUTH_RATE_LIMIT_MAX/)
  })
})
