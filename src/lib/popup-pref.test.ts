import { describe, it, expect, beforeEach, vi } from 'vitest'
import { popupPref, setPopupPref } from './popup-pref'

// The unit run is node — no localStorage. The module touches it only at call
// time, so a per-test in-memory install (the Safari-private-mode posture is
// NOT stubbed here; throwing-storage behavior is the funnel's catch, not a
// pref concern) is enough to drive the key semantics.
beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
})

describe('popupPref', () => {
  it('defaults to ON (unset key → true)', () => {
    expect(popupPref()).toBe(true)
  })

  it("reads '0' as OFF, '1' as ON", () => {
    localStorage.setItem('labhub.popups', '0')
    expect(popupPref()).toBe(false)
    localStorage.setItem('labhub.popups', '1')
    expect(popupPref()).toBe(true)
  })
})

describe('setPopupPref', () => {
  it('false writes labhub.popups=0, true writes 1', () => {
    setPopupPref(false)
    expect(localStorage.getItem('labhub.popups')).toBe('0')
    expect(popupPref()).toBe(false)
    setPopupPref(true)
    expect(localStorage.getItem('labhub.popups')).toBe('1')
    expect(popupPref()).toBe(true)
  })

  it('uses the labhub.popups key (no other storage leakage)', () => {
    setPopupPref(true)
    expect(localStorage.getItem('sounds')).toBeNull()
  })
})
