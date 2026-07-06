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
    expect(e.BETTER_AUTH_SECRET).toHaveLength(32)
  })
  it('throws on missing DATABASE_URL', () => {
    expect(() => parseEnv({ BETTER_AUTH_SECRET: 'x'.repeat(32) })).toThrow(/DATABASE_URL/)
  })
  it('throws on a short or missing BETTER_AUTH_SECRET', () => {
    expect(() => parseEnv({ DATABASE_URL: 'postgresql://x', BETTER_AUTH_SECRET: 'too-short' })).toThrow(/BETTER_AUTH_SECRET/)
    expect(() => parseEnv({ DATABASE_URL: 'postgresql://x' })).toThrow(/BETTER_AUTH_SECRET/)
  })
})
