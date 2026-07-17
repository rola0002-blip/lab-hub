import { describe, it, expect } from 'vitest'
import { trustedIpConfig } from './auth-ip'

describe('trustedIpConfig', () => {
  it('returns undefined when the header is unset (better-auth keeps its x-forwarded-for default)', () => {
    expect(trustedIpConfig(undefined)).toBeUndefined()
  })

  it('returns undefined for a blank or whitespace-only header', () => {
    expect(trustedIpConfig('')).toBeUndefined()
    expect(trustedIpConfig('   ')).toBeUndefined()
  })

  it('reads ONLY the named header when set (cf-connecting-ip behind Cloudflare)', () => {
    expect(trustedIpConfig('cf-connecting-ip')).toEqual({
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    })
  })

  it('trims surrounding whitespace before using the header name', () => {
    expect(trustedIpConfig('  cf-connecting-ip  ')).toEqual({
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    })
  })
})
