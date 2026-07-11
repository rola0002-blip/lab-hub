import { test, expect, type Browser, type Page } from '@playwright/test'
import { wipe, runWizard, signIn, ADMIN, createMemberViaInvite, acceptInvite } from './helpers'

// Per-context client IP so better-auth's per-IP sign-in/up rate limit never trips
// across this serial suite (mirrors messaging.spec.ts). Offset the sequence so it
// never collides with the messaging suite's buckets on a shared runner.
let ipSeq = 100
async function newPage(browser: Browser): Promise<Page> {
  ipSeq += 1
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `10.20.${ipSeq}.7` } })
  return ctx.newPage()
}

test.describe.configure({ mode: 'serial' })
test.beforeEach(async () => { await wipe() })

const PASS = 'MemberPass!1234'
const GUEST = { email: 'gina@lab.test', name: 'Gina Guest' }

async function admin(browser: Browser): Promise<Page> {
  const page = await newPage(browser)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  return page
}

async function createChannel(page: Page, name: string): Promise<string> {
  await page.goto('/chat')
  await page.getByRole('button', { name: 'Browse or create channels' }).click()
  await page.getByRole('button', { name: 'New channel' }).click()
  await page.getByPlaceholder('e.g. cvd-lab').fill(name)
  await page.getByRole('button', { name: 'Create channel', exact: true }).click()
  await page.waitForURL(/\/chat\/[^/]+$/)
  return new URL(page.url()).pathname.split('/').pop()!
}

async function openPalette(page: Page) {
  // Gate on the header pill so the client shell has rendered, then press ⌘K /
  // Ctrl-K (useGlobalHotkey accepts either modifier). Retry the one-shot keypress
  // until the dialog appears — it can fire a frame before the effect subscribes.
  await expect(page.getByRole('button', { name: /Search COLOSSUS/ })).toBeVisible()
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10_000 })
}

test('⌘K palette: type a channel name and Enter navigates to that channel', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  const cid = await createChannel(page, 'photonics')

  // Prove the palette is global (lives in the app shell, not just /chat): jump
  // from a NON-chat page.
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/dashboard$/)

  await openPalette(page)
  const input = page.getByRole('combobox', { name: 'Search COLOSSUS' })
  await input.fill('photon')
  await expect(page.getByRole('option', { name: /photonics/ })).toBeVisible()

  await input.press('Enter')
  await page.waitForURL('**/chat/' + cid)
  await expect(page.getByRole('heading', { name: '#photonics' })).toBeVisible()

  await page.context().close()
})

test('⌘K palette: a guest is never offered Admin/People destinations', async ({ browser }) => {
  test.setTimeout(90_000)
  const adminPage = await admin(browser)
  const token = await createMemberViaInvite(adminPage, GUEST.email, 'guest')
  const pageG = await newPage(browser)
  await acceptInvite(pageG, token, GUEST.name, PASS) // lands on /dashboard, signed in

  await openPalette(pageG)
  const input = pageG.getByRole('combobox', { name: 'Search COLOSSUS' })

  // Positive control: an always-on page IS reachable for a guest.
  await input.fill('dash')
  await expect(pageG.getByRole('option', { name: /Dashboard/ })).toBeVisible()

  // Role-gated exactly like the sidebar: admin-only + non-guest pages are absent.
  await input.fill('settings')
  await expect(pageG.getByText('No matches')).toBeVisible()
  await input.fill('equipment')
  await expect(pageG.getByText('No matches')).toBeVisible()
  await input.fill('people')
  await expect(pageG.getByRole('option', { name: /^People/ })).toHaveCount(0)

  await pageG.context().close()
  await adminPage.context().close()
})

test('profile: rename + accent switch persist across reload', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)

  // Open the profile from the top-bar user menu (not a nav item).
  await page.goto('/dashboard')
  await page.getByRole('button', { name: 'Your account' }).click()
  await page.getByRole('menuitem', { name: 'Profile' }).click()
  await page.waitForURL('**/profile')

  // Rename.
  const nameInput = page.getByLabel('Full name')
  await nameInput.fill('Roland Renamed')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Profile saved.')).toBeVisible()

  // Switch accent to Crimson (a radio in the Appearance radiogroup).
  await page.getByRole('radio', { name: 'Crimson' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'crimson')

  // Reload — both persist (name is server-side; accent via localStorage + account).
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'crimson')
  await expect(page.getByLabel('Full name')).toHaveValue('Roland Renamed')

  await page.context().close()
})
