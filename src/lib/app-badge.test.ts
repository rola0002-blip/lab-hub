import { describe, it, expect, vi } from 'vitest'
import { applyAppBadge } from './app-badge'

// Badging API surface we depend on (structural subset of Navigator).
const stub = (fail = false) => ({
  setAppBadge: vi.fn(() => (fail ? Promise.reject(new Error('SecurityError')) : Promise.resolve())),
  clearAppBadge: vi.fn(() => (fail ? Promise.reject(new Error('SecurityError')) : Promise.resolve())),
})

describe('applyAppBadge', () => {
  it('sets the count when n > 0', () => {
    const s = stub()
    applyAppBadge(3, s)
    expect(s.setAppBadge).toHaveBeenCalledWith(3)
    expect(s.clearAppBadge).not.toHaveBeenCalled()
  })

  it('clears at 0', () => {
    const s = stub(true)
    applyAppBadge(0, s)
    expect(s.clearAppBadge).toHaveBeenCalled()
    expect(s.setAppBadge).not.toHaveBeenCalled()
  })

  it('no-ops where the API is missing (iOS Safari)', () => {
    expect(() => applyAppBadge(5, {})).not.toThrow()
  })

  it('swallows rejections (uninstalled tab) without unhandled-promise noise', async () => {
    applyAppBadge(1, stub(true))
    await new Promise((r) => setTimeout(r, 0)) // a tick for the rejection's catch
  })
})
