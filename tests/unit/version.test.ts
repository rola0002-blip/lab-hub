import { describe, it, expect } from 'vitest'
import pkg from '../../package.json'
import { APP_VERSION } from '@/lib/version'

describe('APP_VERSION', () => {
  it('resolves to the package.json version at build time', () => {
    expect(APP_VERSION).toBe(pkg.version)
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/) // shape only — no frozen literal, so a real `release -- patch` (→ 0.9.1) never breaks this test
  })
})
