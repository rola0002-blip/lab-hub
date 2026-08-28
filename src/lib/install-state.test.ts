import { describe, it, expect } from 'vitest'
import { INSTALL_DISMISS_KEY, isIosUa, shouldShowInstall } from './install-state'

describe('isIosUa', () => {
  it('matches iPhone, iPad, iPod (Safari AND Chrome-on-iOS both surface iOS UAs)', () => {
    expect(isIosUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1')).toBe(true)
    expect(isIosUa('Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 Version/16.6 Mobile/15E148 Safari/604.1')).toBe(true)
    expect(isIosUa('Mozilla/5.0 (iPod touch; CPU iPhone OS 15_8 like Mac OS X)')).toBe(true)
  })
  it('rejects desktop and Android UAs (a touchless Macintosh is not an iPad)', () => {
    expect(isIosUa('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15')).toBe(false)
    expect(isIosUa('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36')).toBe(false)
  })
  it('matches iPadOS 13+ desktop-class UAs via Macintosh + multi-touch', () => {
    const iPadDesktop =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
    expect(isIosUa(iPadDesktop, 5)).toBe(true) // iPads report maxTouchPoints 5
    expect(isIosUa(iPadDesktop, 0)).toBe(false) // a real Mac has 0-1 touch points
  })
})

describe('shouldShowInstall', () => {
  const base = { standalone: false, isIos: false, dismissed: false, deferredAvailable: false, tauri: false }

  it('shows on Chromium only once beforeinstallprompt fired', () => {
    expect(shouldShowInstall(base)).toBe(false)
    expect(shouldShowInstall({ ...base, deferredAvailable: true })).toBe(true)
  })
  it('shows on iOS without any deferred event (Add-to-Home-Screen guide path)', () => {
    expect(shouldShowInstall({ ...base, isIos: true })).toBe(true)
  })
  it('never shows when installed, dismissed, or in the desktop shell', () => {
    for (const over of [{ standalone: true }, { dismissed: true }, { tauri: true }] as const) {
      expect(shouldShowInstall({ ...base, deferredAvailable: true, isIos: true, ...over })).toBe(false)
    }
  })
})

describe('INSTALL_DISMISS_KEY', () => {
  it('is namespaced', () => {
    expect(INSTALL_DISMISS_KEY).toBe('labhub-install-dismissed')
  })
})
