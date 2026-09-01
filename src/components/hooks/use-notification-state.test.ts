import { describe, it, expect } from 'vitest'
import { notifyStatus } from './use-notification-state'

const base = {
  tauri: false, https: true, ios: false, standalone: false,
  serviceWorker: true, pushApi: true, permission: 'default' as NotificationPermission, subscribed: false,
}

describe('notifyStatus', () => {
  it('shell first: the desktop app has notifications built in', () => {
    expect(notifyStatus({ ...base, tauri: true })).toBe('shell')
  })

  it('insecure origins cannot push (warn HTTPS)', () => {
    expect(notifyStatus({ ...base, https: false })).toBe('insecure')
  })

  it('iOS Safari routes to Add-to-Home-Screen first; installed PWA proceeds', () => {
    expect(notifyStatus({ ...base, ios: true, standalone: false })).toBe('ios-install')
    expect(notifyStatus({ ...base, ios: true, standalone: true })).toBe('ready')
  })

  it('no service worker / push API means unsupported', () => {
    expect(notifyStatus({ ...base, serviceWorker: false })).toBe('unsupported')
    expect(notifyStatus({ ...base, pushApi: false })).toBe('unsupported')
  })

  it('missing Notification API (SW+Push present) means unsupported — can never enable', () => {
    expect(notifyStatus({ ...base, permission: 'unsupported' })).toBe('unsupported')
  })

  it('denied permission is its own state (OS-settings guidance)', () => {
    expect(notifyStatus({ ...base, permission: 'denied' })).toBe('denied')
  })

  it('granted + subscribed is done; anything else on a capable device is ready', () => {
    expect(notifyStatus({ ...base, permission: 'granted', subscribed: true })).toBe('done')
    expect(notifyStatus({ ...base })).toBe('ready')
  })
})
