import { describe, it, expect } from 'vitest'
import { contentDisposition } from '@/lib/uploads'

describe('contentDisposition (RFC 5987)', () => {
  it('emits an ASCII fallback plus a UTF-8 star value for a non-ASCII name', () => {
    const h = contentDisposition('attachment', 'résumé — 履歴書.pdf')
    expect(h.startsWith('attachment; filename="')).toBe(true)
    expect(h).toContain("filename*=UTF-8''")
    // The star value round-trips back to the original via decodeURIComponent.
    const star = h.split("filename*=UTF-8''")[1]
    expect(decodeURIComponent(star)).toBe('résumé — 履歴書.pdf')
    // The ASCII fallback carries no raw non-ASCII byte and no unescaped quote/backslash.
    const fallback = h.match(/filename="([^"]*)"/)![1]
    expect(/^[\x20-\x7e]*$/.test(fallback)).toBe(true)
    expect(fallback.includes('"')).toBe(false)
  })
  it('supports an inline disposition and a plain ASCII name unchanged', () => {
    expect(contentDisposition('inline', 'plot.pdf')).toBe(`inline; filename="plot.pdf"; filename*=UTF-8''plot.pdf`)
  })
  it('neutralizes quotes, backslashes and control chars — no raw CR/LF can inject a header', () => {
    const nasty = 'a"b\\c\td\ne.pdf' // double-quote, backslash, TAB, newline
    const h = contentDisposition('attachment', nasty)
    // The whole header value is injection-safe: no raw CR/LF anywhere.
    expect(/[\r\n]/.test(h)).toBe(false)
    // The quoted ASCII fallback carries no raw quote, backslash, or non-printable byte.
    const fallback = h.match(/filename="([^"]*)"/)![1]
    expect(/["\\]/.test(fallback)).toBe(false)
    expect(/[^\x20-\x7e]/.test(fallback)).toBe(false)
    // The star value still preserves the exact original bytes.
    expect(decodeURIComponent(h.split("filename*=UTF-8''")[1])).toBe(nasty)
  })
})
