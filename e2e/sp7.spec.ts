import { test, expect } from '@playwright/test'

// SP7 §7.1 / §12 (E2E): the internet-facing security headers must appear on a real served
// page from the running server (next.config headers() apply in dev + prod, to '/:path*').
// /sign-in is a leaf client page that renders 200 with no org/session, so this is
// deterministic and touches no shared DB state (a plain GET is not rate-limited).
test('security headers are present on a served page', async ({ request }) => {
  const res = await request.get('/sign-in')
  const h = res.headers()
  expect(h['strict-transport-security']).toBe('max-age=63072000; includeSubDomains')
  expect(h['x-content-type-options']).toBe('nosniff')
  expect(h['x-frame-options']).toBe('DENY')
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin')
  expect(h['content-security-policy-report-only']).toContain("default-src 'self'")
})
