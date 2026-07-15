import { describe, it, expect } from 'vitest'
import { parseEnv } from './env'

describe('parseEnv', () => {
  it('parses required vars and defaults', () => {
    const e = parseEnv({
      DATABASE_URL: 'postgresql://x', APP_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASS: 'p',
      SMTP_FROM: 'LabHub <no-reply@example.com>',
    })
    expect(e.SMTP_PORT).toBe(587)
    expect(e.DISABLE_JOBS).toBe(false)
    expect(e.AUTH_RATE_LIMIT_MAX).toBe(10) // safe default; LAN beta raises it (see auth-rate-limit)
    expect(e.BETTER_AUTH_SECRET).toHaveLength(32)
  })
  it('throws on missing DATABASE_URL', () => {
    expect(() => parseEnv({ BETTER_AUTH_SECRET: 'x'.repeat(32) })).toThrow(/DATABASE_URL/)
  })
  it('throws on a short or missing BETTER_AUTH_SECRET', () => {
    expect(() => parseEnv({ DATABASE_URL: 'postgresql://x', BETTER_AUTH_SECRET: 'too-short' })).toThrow(/BETTER_AUTH_SECRET/)
    expect(() => parseEnv({ DATABASE_URL: 'postgresql://x' })).toThrow(/BETTER_AUTH_SECRET/)
  })
  it('VAPID vars default to empty (push disabled)', () => {
    const e = parseEnv({
      DATABASE_URL: 'postgresql://x', APP_URL: 'http://localhost:3000',
      SMTP_HOST: '', SMTP_PORT: '587', SMTP_USER: '', SMTP_PASS: '',
      SMTP_FROM: 'x <x@x>', BETTER_AUTH_SECRET: 'a'.repeat(32),
    })
    expect(e.VAPID_PUBLIC_KEY).toBe('')
    expect(e.VAPID_PRIVATE_KEY).toBe('')
  })
})
