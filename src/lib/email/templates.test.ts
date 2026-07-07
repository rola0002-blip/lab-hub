import { describe, it, expect } from 'vitest'
import { inviteEmail, bookingDecidedEmail, bookingPendingEmail } from './templates'

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
  it('escapes HTML in requester and equipment names so a hostile value cannot inject markup', () => {
    const t = bookingPendingEmail('TAY LABS', '<script>alert(1)</script>', 'CVD <Furnace> & Co', 'Tue 15 Jul, 14:00–18:00')
    expect(t.html).toContain('&lt;script&gt;')
    expect(t.html).toContain('&amp;')
    expect(t.html).not.toContain('<script>')
    expect(t.html).toContain('CVD &lt;Furnace&gt; &amp; Co')
  })
})
