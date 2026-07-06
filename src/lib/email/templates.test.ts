import { describe, it, expect } from 'vitest'
import { inviteEmail, bookingDecidedEmail } from './templates'

describe('email templates', () => {
  it('invite includes org name and link', () => {
    const t = inviteEmail('TAY LABS', 'http://x/accept-invite/tok')
    expect(t.subject).toContain('TAY LABS')
    expect(t.html).toContain('http://x/accept-invite/tok')
  })
  it('decision email distinguishes approve/reject and carries the reason', () => {
    expect(bookingDecidedEmail('TAY LABS', 'CVD Furnace', 'Tue 15 Jul, 14:00–18:00', true).subject).toMatch(/approved/i)
    const rej = bookingDecidedEmail('TAY LABS', 'CVD Furnace', 'Tue 15 Jul, 14:00–18:00', false, 'No training record')
    expect(rej.subject).toMatch(/rejected/i)
    expect(rej.html).toContain('No training record')
  })
})
