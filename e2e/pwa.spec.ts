import { test, expect } from '@playwright/test'
import { wipe, runWizard, signIn, ADMIN, waitForHydration } from './helpers'

// PWA completion (2026-08-27 spec): manifest identity, SW registration +
// offline shell, and the bell-tray install affordance (Chromium sheet path vs
// iOS Add-to-Home-Screen guide path).
//
// Per-context client IP so better-auth's per-IP limit never trips. Bands up to
// 10.90 belong to other suites and 10.91 is mobile.spec's — this file claims
// 10.92.x.
let ipSeq = 0
const ip = () => `10.92.${++ipSeq}.7`

test.describe.configure({ mode: 'serial' })
test.beforeEach(async () => { await wipe() })

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

async function openBell(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Notifications' }).click()
}

test('manifest: install identity, dark boot, shortcuts, maskable icon, sw headers', async ({ request }) => {
  const m = await (await request.get('/manifest.webmanifest')).json()
  expect(m.id).toBe('/')
  expect(m.scope).toBe('/')
  expect(m.display).toBe('standalone')
  expect(m.orientation).toBe('any')
  expect(m.background_color).toBe('#1a1d21')
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true)
  expect(m.shortcuts.map((s: { url: string }) => s.url)).toEqual(['/chat', '/booking', '/issues'])
  const swHead = await request.get('/sw.js')
  expect(swHead.headers()['cache-control']).toContain('no-cache')
})

test('service worker controls the page and serves the offline shell', async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ip() } })
  const page = await ctx.newPage()
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  await waitForHydration(page)
  // clients.claim() in the SW's activate makes it control this first load.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 15_000 })
  await ctx.setOffline(true)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible()
  await ctx.setOffline(false)
  // Not page.reload(): Chromium aborts a reload issued immediately after the
  // offline→online transition (net::ERR_ABORTED) — a fresh navigation to the
  // same URL proves the network path serves the app again.
  await page.goto('/')
  await expect(page.getByRole('main')).toBeVisible()
  await ctx.close()
})

test('install row (Chromium): sheet path, dismiss persists', async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ip() } })
  // Synthetic deferred prompt, dispatched post-hydration — real Chrome fires
  // beforeinstallprompt on engagement heuristics while the app is open, and
  // the landing after sign-in is a client-side router.push (no `load` event
  // after the bell mounts, so a load-timed dispatch is never heard).
  const fireInstallPrompt = (page: import('@playwright/test').Page) =>
    page.evaluate(() => {
      const ev = new Event('beforeinstallprompt', { cancelable: true })
      Object.assign(ev, { prompt: async () => undefined })
      window.dispatchEvent(ev)
    })
  const page = await ctx.newPage()
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  await waitForHydration(page)
  await fireInstallPrompt(page)
  await openBell(page)
  await expect(page.getByRole('button', { name: 'Install app' })).toBeVisible()
  // Dismiss → gone now and stays gone after reload (localStorage), even when
  // Chrome re-fires beforeinstallprompt after engagement re-qualification.
  await page.getByRole('button', { name: 'Dismiss install prompt' }).click()
  await expect(page.getByRole('button', { name: 'Install app' })).toBeHidden()
  await page.reload()
  await waitForHydration(page)
  await fireInstallPrompt(page)
  await openBell(page)
  await expect(page.getByRole('button', { name: 'Install app' })).toBeHidden()
  await ctx.close()
})

test('install row (iOS): guide path', async ({ browser }) => {
  const ctx = await browser.newContext({
    userAgent: IOS_UA,
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
    extraHTTPHeaders: { 'x-forwarded-for': ip() },
  })
  const page = await ctx.newPage()
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  await waitForHydration(page)
  await openBell(page)
  await expect(page.getByRole('button', { name: 'Install app' })).toBeVisible()
  await page.getByRole('button', { name: 'Install app' }).tap()
  await expect(page.getByText('Add to Home Screen')).toBeVisible()
  await page.getByRole('button', { name: 'Got it' }).tap()
  await expect(page.getByRole('button', { name: 'Install app' })).toBeHidden()
  await ctx.close()
})
