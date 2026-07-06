import { describe, it, expect } from 'vitest'
import { parseEnv } from './env'

describe('parseEnv', () => {
  it('parses required vars and defaults', () => {
    const e = parseEnv({
      DATABASE_URL: 'postgresql://x', APP_URL: 'http://localhost:3000',
      SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASS: 'p',
      SMTP_FROM: 'LabHub <no-reply@example.com>',
    })
    expect(e.SMTP_PORT).toBe(587)
    expect(e.DISABLE_JOBS).toBe(false)
  })
  it('throws on missing DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/)
  })
})
