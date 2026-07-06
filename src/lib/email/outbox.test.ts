import { describe, it, expect } from 'vitest'
import { drainOutbox } from './outbox'

// Unit-level coverage of the no-transport short-circuit: with SMTP unset in the
// vitest env, defaultSend() returns null and drainOutbox never touches the DB.
// The success/retry loop (which needs Postgres) is covered by the integration
// suite in tests/integration/outbox.test.ts.
describe('drainOutbox without a transport', () => {
  it('returns 0 when SMTP is not configured', async () => {
    expect(await drainOutbox()).toBe(0)
  })
})
