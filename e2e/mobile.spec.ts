import { test, expect, type Browser, type Page } from '@playwright/test'
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import { db, wipe, runWizard, signIn, ADMIN, createMemberViaInvite, acceptInvite } from './helpers'
import { rowsToRange } from '@/features/booking/grid'

// v0.14 "mobile UX": the booking schedule becomes one responsive component — the
// 7-column week grid at md+, a single touch-sized day column below it — plus a
// keyboard-reachable New booking path into the (now editable) dialog.
//
// Per-context client IP so better-auth's per-IP sign-in/up limit never trips. Bands
// 10.10 / 10.20 / 10.30 / 10.40 / 10.41 / 10.50 / 10.60 / 10.70 / 10.80 / 10.90 are
// taken by the other suites, so this file claims 10.91.x and stays out of every
// other bucket.
//
// TWO LOCATOR RULES hold for every test in this file:
//  1. Next's dev SSR leaves a HIDDEN duplicate of the streamed tree in `div#S:0` at
//     body level, so CSS/text locators (unlike role locators, which skip the
//     a11y-hidden copy) resolve twice under strict mode. Every CSS/text locator here
//     is rooted at <main> (e2e/v012.spec.ts:28-30).
//  2. Accessible-name matching is a case-insensitive SUBSTRING match, and the header
//     now carries a `New booking` button — so every `Book` press is dialog-scoped or
//     `exact: true` (both, here). The same collision forced the one sanctioned edit
//     in e2e/journeys.spec.ts this wave.

const PHONE = { width: 375, height: 812 }
const main = (page: Page) => page.getByRole('main')
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Book this slot' })
// The day bar's current-day label; the arrows are found by their aria-labels, which
// are identical across the button (interior) and link (week-crossing) renderings.
const dayLabel = (page: Page) => main(page).getByRole('group', { name: 'Day' }).locator('span')

let ipSeq = 0
async function phonePage(browser: Browser): Promise<Page> {
  ipSeq += 1
  const ctx = await browser.newContext({ viewport: PHONE, hasTouch: true, isMobile: true, extraHTTPHeaders: { 'x-forwarded-for': `10.91.${ipSeq}.7` } })
  return ctx.newPage()
}
async function desktopPage(browser: Browser): Promise<Page> {
  ipSeq += 1
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `10.91.${ipSeq}.7` } })
  return ctx.newPage()
}

// The journeys shape: serial, wiped between tests, each test runs its own wizard.
test.describe.configure({ mode: 'serial' })
test.beforeEach(async () => { await wipe() })

// A week whose every day is in the future, so nothing the schedule offers is blocked
// by the in_past rule (journeys.spec.ts:55 uses the same +8d anchor).
const futureWeek = () => new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10)

test('phone gets a day view with a coarse pointer', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await phonePage(browser)
  await runWizard(page)
  const eq = await db.equipment.create({ data: { name: 'Raman', approvalPolicy: 'NONE' } })
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto(`/booking/${eq.id}?week=${futureWeek()}`)

  // Guard: the whole coarse-pointer half of this wave is gated on this media query.
  // Assert the emulation really produces it, so a Playwright/Chromium drift fails
  // here with an obvious message instead of silently exercising the desktop paths.
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)

  // ONE day column (the week grid renders seven). Polls past the SSR week paint.
  await expect(main(page).locator('div.relative.border-l')).toHaveCount(1)
  await expect(main(page).getByLabel('Previous day')).toBeVisible()
  await expect(main(page).getByLabel('Next day')).toBeVisible()
  await expect(dayLabel(page)).toBeVisible()

  // The week grid's 720px floor is week-layout-only, so the day view fits the phone
  // without a horizontal scroller.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width)
})

test('day bar navigates within the week and links across the boundary', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await phonePage(browser)
  await runWizard(page)
  const eq = await db.equipment.create({ data: { name: 'Raman', approvalPolicy: 'NONE' } })
  await signIn(page, ADMIN.email, ADMIN.password)
  const week = futureWeek()
  await page.goto(`/booking/${eq.id}?week=${week}`)
  await expect(dayLabel(page)).toBeVisible()

  // The viewed week does not contain today, so the view opens on day 0 — where the
  // ‹ is a week-crossing LINK landing on the far edge of the previous week.
  await expect(main(page).getByLabel('Previous day')).toHaveAttribute('href', /\?week=\d{4}-\d{2}-\d{2}&day=6/)

  // Interior moves are client state over the already-fetched week: the label advances
  // and the URL never changes.
  const first = (await dayLabel(page).textContent())!
  await main(page).getByLabel('Next day').click()
  await expect(dayLabel(page)).not.toHaveText(first)
  expect(page.url()).toContain(`?week=${week}`)

  // Five more ›: day 1 → day 6, where › becomes the forward week-crossing link.
  for (let i = 0; i < 5; i++) await main(page).getByLabel('Next day').click()
  await expect(main(page).getByLabel('Next day')).toHaveAttribute('href', /\?week=\d{4}-\d{2}-\d{2}&day=0/)
  expect(page.url()).toContain(`?week=${week}`)
})

test('New booking button books the SELECTED range (desktop keyboard path)', async ({ browser }) => {
  test.setTimeout(120_000)
  const adminPage = await desktopPage(browser)
  await runWizard(adminPage)
  const eq = await db.equipment.create({ data: { name: 'Raman', approvalPolicy: 'NONE' } })
  await signIn(adminPage, ADMIN.email, ADMIN.password)
  // Booked as a MEMBER, not the admin: `isManagerOf` treats every admin as a manager
  // of every instrument, and the manager arm of evaluateBooking skips BOTH the
  // advance-window and max-duration rules (policy.ts:41-48) — so the negative preview
  // arm below (16 h > the 480-minute default) would verdict `instant` for an admin.
  const token = await createMemberViaInvite(adminPage, 'mei@lab.test', 'member')
  const page = await desktopPage(browser)
  await acceptInvite(page, token, 'Mei', 'MemberPass!1234')

  const org = await db.organization.findFirstOrThrow()
  await page.goto(`/booking/${eq.id}`)

  // Keyboard path: focus the header button and activate it with Enter.
  const trigger = main(page).getByRole('button', { name: 'New booking' })
  await trigger.focus()
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Enter')
  const dlg = dialog(page)
  await expect(dlg).toBeVisible()

  // The two time selects are located by ROLE, not by label: `getByLabel` matches the
  // label element's rendered TEXT, and a <label> wrapping a <select> has every
  // <option> in its textContent ("From07:0007:30…"), so no exact label match exists.
  // The accessible NAME is computed properly ("From"), so getByRole is the exact,
  // non-positional locator here. (`<input>` labels are unaffected — Date/Purpose
  // contribute no text — so those stay on getByLabel.)
  const from = dlg.getByRole('combobox', { name: 'From', exact: true })
  const to = dlg.getByRole('combobox', { name: 'To', exact: true })

  // A known future weekday inside the 14-day advance window, in ORG time.
  const dateStr = format(new TZDate(new Date(Date.now() + 8 * 86_400_000), org.timezone), 'yyyy-MM-dd')
  await dlg.getByLabel('Date', { exact: true }).fill(dateStr)
  await from.selectOption('6')   // 10:00
  await to.selectOption('10')    // 12:00
  await expect(dlg.getByText('confirm instantly')).toBeVisible()

  // Negative arm — 07:00–23:00 is 16 h against a 480-minute cap. The verdict can only
  // change if the preview re-fires from the dialog's OWN range state (T2's contract).
  await from.selectOption('0')
  await to.selectOption('32')
  await expect(dlg.getByText(/Maximum booking length/)).toBeVisible()
  await expect(dlg.getByText('confirm instantly')).toHaveCount(0)

  // Restore the known range and book it.
  await from.selectOption('6')
  await to.selectOption('10')
  await expect(dlg.getByText('confirm instantly')).toBeVisible()
  await dlg.getByLabel('Purpose', { exact: true }).fill('e2e new booking')
  await dlg.getByRole('button', { name: 'Book', exact: true }).click()
  await expect(dlg.getByRole('button', { name: 'Add to calendar' })).toBeVisible()

  // The gate this test exists for: the SELECTED range — not the range the dialog
  // opened with — is what reached POST /api/bookings.
  const { start, end } = rowsToRange(dateStr, 6, 10, org.timezone)
  const b = await db.booking.findFirstOrThrow({ where: { equipmentId: eq.id } })
  expect(b.startsAt.toISOString()).toBe(start.toISOString())
  expect(b.endsAt.toISOString()).toBe(end.toISOString())
})

// Permanent home for the T2 review's cleared-date regression: `<input type="date">`
// reports '' for a cleared value, which reached rowsToRange as an Invalid Date and
// threw RangeError DURING RENDER — and with no error.tsx anywhere, Next replaced the
// whole route and the half-filled dialog with it.
test('clearing the dialog date keeps the last valid date instead of crashing the route', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await desktopPage(browser)
  const pageErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  await runWizard(page)
  const eq = await db.equipment.create({ data: { name: 'Raman', approvalPolicy: 'NONE' } })
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto(`/booking/${eq.id}`)

  await main(page).getByRole('button', { name: 'New booking' }).click()
  const date = dialog(page).getByLabel('Date', { exact: true })
  const before = await date.inputValue()
  await date.fill('')
  await expect(dialog(page)).toBeVisible()          // the route survived
  expect(await date.inputValue()).toBe(before)      // React restored the last valid date
  expect(pageErrors).toEqual([])
})
