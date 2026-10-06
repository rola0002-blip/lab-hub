import { describe, it, expect } from 'vitest'
import { healPlan, PUSH_ENDPOINT_KEY } from './push-heal'

describe('healPlan', () => {
  const ep = 'https://fcm.googleapis.com/fcm/send/abc'

  it('permission not granted → skip (never auto-subscribe an opted-out user)', () => {
    expect(healPlan({ permissionGranted: false, storedEndpoint: null, currentEndpoint: null })).toBe('skip')
    expect(healPlan({ permissionGranted: false, storedEndpoint: ep, currentEndpoint: ep })).toBe('skip')
  })

  it('granted but subscription gone (iOS silent revocation) → resubscribe', () => {
    expect(healPlan({ permissionGranted: true, storedEndpoint: ep, currentEndpoint: null })).toBe('resubscribe')
  })

  it('endpoint rotated or first heal → repost', () => {
    expect(healPlan({ permissionGranted: true, storedEndpoint: null, currentEndpoint: ep })).toBe('repost')
    expect(healPlan({ permissionGranted: true, storedEndpoint: 'https://fcm.googleapis.com/fcm/send/old', currentEndpoint: ep })).toBe('repost')
  })

  it('steady state (server already knows this endpoint) → skip (no per-load POST)', () => {
    expect(healPlan({ permissionGranted: true, storedEndpoint: ep, currentEndpoint: ep })).toBe('skip')
  })

  it('endpoint storage key is stable', () => {
    expect(PUSH_ENDPOINT_KEY).toBe('labhub.push-endpoint')
  })
})
