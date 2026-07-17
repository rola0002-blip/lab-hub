import { test, expect, type Browser, type Page } from '@playwright/test'
import pkg from '../package.json'
import { wipe, seedSystem, runWizard, signIn, ADMIN } from './helpers'

// Per-context client IP so better-auth's per-IP sign-in/up rate limit (10/60 s on
// /sign-in/email + /sign-up/email) never trips. On localhost every request otherwise
// shares one bucket; by the time this suite runs the shared-localhost bucket is already
// near the limit, so the first sign-in here 429s ("Too many requests"). A unique single
// x-forwarded-for IP buckets each context separately (better-auth trusts a lone forwarded
// IP with no trustedProxies), so each sign-in sits at count 1 — mirrors the
// sp5/files/a11y/messaging/redesign suites. Band 10.60.x is unused by the others.
let ipSeq = 0
async function newPage(browser: Browser): Promise<Page> {
  ipSeq += 1
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `10.60.${ipSeq}.7` } })
  return ctx.newPage()
}

// Serial + one-time wipe/seed: the version-surface test provisions the org + admin the
// later tests reuse (workers:1 → one shared database). seedSystem() reinstalls the bot +
// #lab-updates channel so the auth after-hook's auto-join succeeds (mirrors sp5/files).
test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => { await wipe(); await seedSystem() })

test('GET /api/health is reachable unauthenticated and returns { ok, version } over HTTP', async ({ request }) => {
  // The update script's actual contract: a plain HTTP GET with NO auth/session must
  // return 200 and EXACTLY { ok: true, version: <pkg.version> }. Unlike the integration
  // test (which calls the handler directly), this exercises real routing + middleware,
  // proving the probe is not behind auth and leaks nothing beyond ok + version.
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  expect(await res.json()).toEqual({ ok: true, version: pkg.version })
})

test('version surface: sidebar footer + Settings About show the package version', async ({ browser }) => {
  const page = await newPage(browser)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  // Sidebar footer (present on every authed page).
  await expect(page.getByText(`v${pkg.version}`)).toBeVisible()
  // Settings About block + (SMTP unset in e2e) the no-SMTP indicator lands here later (T4).
  await page.goto('/admin/settings')
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  await expect(page.getByText(`LabHub v${pkg.version}`)).toBeVisible()
})

test('an admin creates an invite, copies the accept link, and it reaches the accept flow', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/people')
  await page.fill('input[name=email]', 'newbie@lab.test')
  await page.selectOption('select[name=role]', 'member')
  await page.click('button:has-text("Invite")')
  await expect(page.getByText('Invitation sent.')).toBeVisible()
  // The accept URL is rendered as a selectable readonly field — the guaranteed path on the
  // plain-HTTP LAN, where navigator.clipboard is undefined. Read it directly (NOT via the
  // clipboard) so this test actually exercises the production onboarding path, not just the
  // localhost-only secure-context clipboard.
  const url = await page.getByLabel('Invite link').first().inputValue()
  expect(url).toContain('/accept-invite/')
  // Copy button is progressive enhancement: on localhost (a secure context) the clipboard
  // write succeeds and toasts. Grant permission and assert the enhancement still works here.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: 'Copy invite link' }).first().click()
  await expect(page.getByText('Invite link copied')).toBeVisible()
  // Visiting the surfaced URL reaches account creation — no SMTP required.
  await page.goto(new URL(url).pathname)
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
})

test('with SMTP unset, the Settings page shows the email-disabled indicator', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/admin/settings')
  await expect(page.getByText(/Email delivery: disabled/)).toBeVisible()
})
