import { describe, it, expect } from 'vitest'
import nextConfig from '../../next.config'

describe('next.config security headers', () => {
  it('applies the internet-facing header set to every route', async () => {
    const rules = await nextConfig.headers!()
    expect(rules).toHaveLength(2)
    const rule = rules[0]
    expect(rule.source).toBe('/:path*')
    const map = Object.fromEntries(rule.headers.map((h) => [h.key, h.value]))
    expect(map['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains')
    expect(map['X-Content-Type-Options']).toBe('nosniff')
    expect(map['X-Frame-Options']).toBe('DENY')
    expect(map['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    // Report-only CSP: present, self-based, frames denied, no bare X-Content-Type sniffing.
    const csp = map['Content-Security-Policy-Report-Only']
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    // HSTS must NOT carry preload (a hard-to-reverse apex-wide commitment — spec §7.1).
    expect(map['Strict-Transport-Security']).not.toContain('preload')
    // The enforcing CSP header must NOT ship this wave — only the report-only variant.
    expect(map['Content-Security-Policy']).toBeUndefined()
  })

  it('pins /sw.js to no-cache as the last rule so it wins the Cache-Control conflict', async () => {
    const rules = await nextConfig.headers!()
    // Next lets the LAST matching entry win a same-key conflict, so the /sw.js
    // pin must come after the /:path* catch-all — otherwise its Cache-Control
    // would lose and stale service workers could stall updates.
    const swRule = rules[rules.length - 1]
    expect(swRule.source).toBe('/sw.js')
    expect(swRule.headers).toEqual([{ key: 'Cache-Control', value: 'no-cache' }])
  })
})
