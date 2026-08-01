import { test, expect, type Browser, type Page } from '@playwright/test'
import { wipe, seedSystem, runWizard, signIn, ADMIN, db } from './helpers'

// Per-context client IP. better-auth rate-limits /sign-in/email + /sign-up/email at
// 10/60 s keyed by client IP; on localhost every request otherwise shares one bucket
// and this file's four sign-ins trip the limit mid-run (identical to the messaging /
// redesign / a11y suites). A unique single-IP x-forwarded-for buckets each context
// separately (better-auth trusts a lone forwarded IP with no trustedProxies), so each
// sign-in sits at count 1. Band 10.40.x is unused by the other suites.
let ipSeq = 0
async function newPage(browser: Browser): Promise<Page> {
  ipSeq += 1
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `10.40.${ipSeq}.7` } })
  return ctx.newPage()
}

// Serial + one-time wipe/seed: test 1 provisions the org + admin the later tests reuse.
test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => { await wipe(); await seedSystem() })

test('profile Calendar-sync card: copy + regenerate', async ({ browser }) => {
  const page = await newPage(browser)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Calendar sync' })).toBeVisible()
  const https = page.getByLabel('https subscription URL')
  const before = await https.inputValue()
  expect(before).toMatch(/\/api\/calendar\/.+\.ics$/)
  page.on('dialog', (d) => d.accept()) // confirm() in regenerate
  await page.getByRole('button', { name: 'Regenerate link' }).click()
  await expect(async () => expect(await https.inputValue()).not.toBe(before)).toPass()
})

test('equipment approval dropdown shows plain-language labels and persists a change', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/admin/equipment/new')
  const select = page.locator('select[name=approvalPolicy]')
  await expect(select.locator('option', { hasText: 'No approval needed' })).toHaveCount(1)
  await expect(select.locator('option', { hasText: 'Only guests need approval' })).toHaveCount(1)
  await expect(select.locator('option', { hasText: 'Everyone needs approval' })).toHaveCount(1)
  await page.fill('input[name=name]', 'Raman')
  await select.selectOption('ALL')
  await page.click('button:has-text("Save")')
  await page.waitForURL('**/admin/equipment')
  await expect(page.getByText('Raman')).toBeVisible()
})

test('creating an issue posts to #lab-updates', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  // Create an issue via the composer, then confirm the bot posted in #lab-updates.
  // The "New issue" trigger renders on the issues surfaces (not the dashboard), so
  // navigate there first — same entry point the other specs use.
  await page.goto('/issues')
  await page.getByRole('button', { name: 'New issue' }).first().click()
  await page.getByLabel('Issue title').fill('e2e furnace check')
  await page.getByRole('button', { name: 'Create issue' }).click()
  await page.waitForURL(/\/issues\/LAB-\d+$/)
  await page.goto('/chat')
  await page.getByRole('link', { name: /lab-updates/ }).click()
  // The bot's post renders the LAB-<n> reference as a resolved pill (identifier +
  // title spans), so the regex matches more than one node — assert the first.
  await expect(page.getByText(/e2e furnace check|LAB-\d+/).first()).toBeVisible()
})

test('a confirmed booking shows the Add to calendar affordance on /bookings', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  // Instant-confirm a booking on a NONE-policy instrument (spec §9 acceptance item),
  // then assert the control is present on the resulting upcoming row.
  const eq = await db.equipment.create({ data: { name: 'e2e furnace', approvalPolicy: 'NONE' } })
  const starts = new Date(Date.now() + 24 * 3_600_000)
  const r = await page.request.post('/api/bookings', {
    data: { equipmentId: eq.id, startsAt: starts, endsAt: new Date(+starts + 2 * 3_600_000), purpose: 'e2e run' },
  })
  expect(r.status()).toBe(201)
  expect((await r.json()).pending).toBe(false) // NONE policy → instant confirm
  await page.goto('/bookings')
  await expect(page.getByRole('button', { name: 'Add to calendar' }).first()).toBeVisible()

  // …and the menu it opens is usable. Regression (v0.10.0): the Upcoming <ul> carried
  // `overflow-hidden`, so menu.tsx's clip-bound pass treated that list as the popover's
  // clipping ancestor; with a single upcoming row the list is barely taller than the
  // trigger, so the popover was capped to a ~1px sliver whose options were scrolled out
  // of sight while their layout rects sat below it — clicks fell through to the page.
  await page.getByRole('button', { name: 'Add to calendar' }).first().click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect.poll(() => menu.evaluate((el) => el.getBoundingClientRect().height + 1 < el.scrollHeight)).toBe(false)
  // Click the item's measured coordinates rather than locator.click(): the latter
  // scroll-into-views every scrollable ancestor (an overflow:hidden box included, which
  // a user can never scroll), so it does not reproduce what the user's pointer does.
  // 'Google Calendar' opens a new tab, which is observable without leaving /bookings.
  const box = (await page.getByRole('menuitem', { name: 'Google Calendar' }).boundingBox())!
  const [popup] = await Promise.all([
    page.context().waitForEvent('page'),
    page.mouse.click(box.x + box.width / 2, box.y + box.height / 2),
  ])
  expect(popup.url()).toContain('calendar.google.com')
  await popup.close()
})
