import { test, expect, type Browser, type Page } from '@playwright/test'
import { wipe, runWizard, signIn, ADMIN } from './helpers'

// Regression for the v0.9.4 report: the phone hamburger opens the primary-nav drawer,
// but navigating to another tab left the drawer OPEN over the new page — and left the
// rest of the shell stuck `inert` (an accessibility trap: the page you navigated to
// was unreachable). The drawer now auto-closes on route change (usePathname) and on
// any nav-link tap; closing runs the inert/focus cleanup. These specs open the drawer
// at phone width, navigate, and assert the drawer is gone AND `#app-content` is
// interactive again.

const DIR = '/private/tmp/claude-501/-Users-roland/3031bedc-03e3-46c7-9ffc-be261f3c6dc0/scratchpad/fix-repro'
const TAG = process.env.REPRO_TAG ?? 'after'
const PHONE = { width: 375, height: 812 }

// Per-context client IP (see status-menu.spec.ts); a distinct range from the other suites.
let ipSeq = 60
async function phonePage(browser: Browser): Promise<Page> {
  ipSeq += 1
  const ctx = await browser.newContext({ viewport: PHONE, extraHTTPHeaders: { 'x-forwarded-for': `10.41.${ipSeq}.7` } })
  return ctx.newPage()
}

test.describe.configure({ mode: 'serial' })
test.beforeEach(async () => { await wipe() })

test('mobile nav drawer auto-closes after navigating to another tab', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await phonePage(browser)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/dashboard')

  const drawer = page.getByRole('dialog', { name: 'Navigation' })

  // Open the drawer via the hamburger; the rest of the shell goes inert.
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(drawer).toBeVisible()
  await expect(page.locator('#app-content')).toHaveAttribute('inert', '')

  // Navigate to a DIFFERENT tab from inside the drawer → drawer dismisses (route change)
  // and the shell becomes interactive again. Both were stuck before the fix.
  await drawer.getByRole('link', { name: 'Files' }).click()
  await page.waitForURL('**/files')
  await expect(drawer).toBeHidden()
  await expect(page.locator('#app-content')).not.toHaveAttribute('inert', '')
  await page.screenshot({ path: `${DIR}/fix3-afternav-${TAG}.png` })

  // Re-open, then tap the CURRENT tab (same route → no pathname change): the nav-link
  // click path must still dismiss it (and clear inert).
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(drawer).toBeVisible()
  await drawer.getByRole('link', { name: 'Files' }).click()
  await expect(drawer).toBeHidden()
  await expect(page.locator('#app-content')).not.toHaveAttribute('inert', '')

  await page.context().close()
})
