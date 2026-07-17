import { describe, it, expect } from 'vitest'
import { isAllowedPushEndpoint } from '@/lib/push-endpoint'

describe('isAllowedPushEndpoint (SP7 F6 — push SSRF guard)', () => {
  it('accepts legitimate push-service https endpoints', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc123')).toBe(true)
    expect(isAllowedPushEndpoint('https://android.googleapis.com/gcm/send/xyz')).toBe(true)
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/gAA')).toBe(true)
    expect(isAllowedPushEndpoint('https://web.push.apple.com/QABC')).toBe(true)
    expect(isAllowedPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=AwYA')).toBe(true)
  })

  it('rejects non-https schemes', () => {
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false)
    expect(isAllowedPushEndpoint('ftp://fcm.googleapis.com/x')).toBe(false)
  })

  it('rejects loopback, private, link-local, and docker-internal hosts', () => {
    expect(isAllowedPushEndpoint('https://127.0.0.1/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://localhost/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://10.0.0.5/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://192.168.1.10/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://169.254.169.254/latest/meta-data')).toBe(false)
    expect(isAllowedPushEndpoint('https://[::1]/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://host.docker.internal/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://db/x')).toBe(false)
  })

  it('rejects arbitrary internet targets not on the allowlist', () => {
    expect(isAllowedPushEndpoint('https://evil.example.com/collect')).toBe(false)
    // Suffix-spoofing attempts must not slip through.
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.com/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://notfcm.googleapis.com.attacker.net/x')).toBe(false)
  })

  it('rejects unparseable input', () => {
    expect(isAllowedPushEndpoint('not a url')).toBe(false)
    expect(isAllowedPushEndpoint('')).toBe(false)
  })
})
