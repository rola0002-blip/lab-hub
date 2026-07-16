import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  setupTokenConfigured,
  setupTokenMatches,
  runAuthorizedBootstrap,
  inAuthorizedBootstrap,
} from '@/lib/setup-token'

afterEach(() => vi.unstubAllEnvs())

describe('setup-token gate (pure)', () => {
  it('is not configured when SETUP_TOKEN is unset or blank', () => {
    vi.stubEnv('SETUP_TOKEN', '')
    expect(setupTokenConfigured()).toBe(false)
    vi.stubEnv('SETUP_TOKEN', undefined as unknown as string)
    expect(setupTokenConfigured()).toBe(false)
  })

  it('is configured when SETUP_TOKEN is a non-empty value', () => {
    vi.stubEnv('SETUP_TOKEN', 'abc123')
    expect(setupTokenConfigured()).toBe(true)
  })

  it('accepts any value (gate disabled) when SETUP_TOKEN is unset', () => {
    vi.stubEnv('SETUP_TOKEN', '')
    expect(setupTokenMatches(undefined)).toBe(true)
    expect(setupTokenMatches('anything')).toBe(true)
    expect(setupTokenMatches('')).toBe(true)
  })

  it('accepts only the exact token when the gate is configured', () => {
    vi.stubEnv('SETUP_TOKEN', 's3cr3t-token')
    expect(setupTokenMatches('s3cr3t-token')).toBe(true)
  })

  it('rejects a wrong, absent, or empty token when the gate is configured', () => {
    vi.stubEnv('SETUP_TOKEN', 's3cr3t-token')
    expect(setupTokenMatches('wrong')).toBe(false)
    expect(setupTokenMatches('')).toBe(false)
    expect(setupTokenMatches(undefined)).toBe(false)
    expect(setupTokenMatches(null)).toBe(false)
    // length differences must not throw (timing-safe compare guards length)
    expect(setupTokenMatches('s3cr3t-token-longer')).toBe(false)
    expect(setupTokenMatches('short')).toBe(false)
  })
})

describe('authorized-bootstrap async context', () => {
  it('reports false outside a bootstrap scope', () => {
    expect(inAuthorizedBootstrap()).toBe(false)
  })

  it('reports true only inside runAuthorizedBootstrap and does not leak out', async () => {
    expect(inAuthorizedBootstrap()).toBe(false)
    const seen = await runAuthorizedBootstrap(async () => {
      await Promise.resolve()
      return inAuthorizedBootstrap()
    })
    expect(seen).toBe(true)
    expect(inAuthorizedBootstrap()).toBe(false)
  })

  it('does not bleed the flag into a concurrent, unrelated async task', async () => {
    let concurrentSaw: boolean | null = null
    const outside = (async () => {
      // Runs in its own async context, interleaved with the bootstrap below.
      await Promise.resolve()
      concurrentSaw = inAuthorizedBootstrap()
    })()
    await runAuthorizedBootstrap(async () => {
      await Promise.resolve()
    })
    await outside
    expect(concurrentSaw).toBe(false)
  })
})
