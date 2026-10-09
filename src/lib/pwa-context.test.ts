import { describe, it, expect, vi, afterEach } from 'vitest'
import { inStandalonePwa } from './pwa-context'

const media = (matches: boolean) => ({ matches })
const fakeWindow = (mm: unknown) => ({ matchMedia: mm })

describe('inStandalonePwa', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('no window (SSR/node) → false', () => {
    expect(inStandalonePwa()).toBe(false)
  })

  it('display-mode: standalone → true (Chromium installed PWA)', () => {
    vi.stubGlobal('window', fakeWindow((q: string) => media(q === '(display-mode: standalone)')))
    expect(inStandalonePwa()).toBe(true)
  })

  it('browser tab (no standalone media query match) → false', () => {
    vi.stubGlobal('window', fakeWindow(() => media(false)))
    vi.stubGlobal('navigator', {})
    expect(inStandalonePwa()).toBe(false)
  })

  it('navigator.standalone (iOS home-screen app) → true', () => {
    vi.stubGlobal('window', fakeWindow(() => media(false)))
    vi.stubGlobal('navigator', { standalone: true })
    expect(inStandalonePwa()).toBe(true)
  })

  it('missing matchMedia falls back to navigator.standalone', () => {
    vi.stubGlobal('window', { })
    vi.stubGlobal('navigator', { standalone: true })
    expect(inStandalonePwa()).toBe(true)
  })
})
