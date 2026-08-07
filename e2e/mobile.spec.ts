import { test, expect, type Browser, type Locator, type Page } from '@playwright/test'
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import { db, wipe, runWizard, signIn, ADMIN, createMemberViaInvite, acceptInvite } from './helpers'
import { ROW_PX_DAY, rangeToRows, rowsToRange } from '@/features/booking/grid'

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
// The coarse-pointer create gesture's overlay and the one day column it lives in.
const dayColumn = (page: Page) => main(page).locator('div.relative.border-l')
const draftBlock = (page: Page) => main(page).locator('[data-draft-block]')
// Tap the centre of a grid row in the (single) day column. The cells are absolutely
// positioned children of the column, so a positioned click on the column lands on
// exactly one of them — no per-row locator needed.
const tapRow = (page: Page, row: number) =>
  dayColumn(page).click({ position: { x: 40, y: row * ROW_PX_DAY + ROW_PX_DAY / 2 } })

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

// ── T4: the coarse-pointer tap → draft → drag-handles create gesture ──────────
// The handles are driven with `page.mouse` INSIDE a hasTouch context on purpose:
// the gesture is gated by `(pointer: coarse)`, never by an event's `pointerType`,
// precisely so a synthetic pointer stream can exercise it (spec §4.3).

test('phone books via tap → draft → handle drag → Book', async ({ browser }) => {
  test.setTimeout(120_000)
  const page = await phonePage(browser)
  await runWizard(page)
  const eq = await db.equipment.create({ data: { name: 'Raman', approvalPolicy: 'NONE' } })
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto(`/booking/${eq.id}?week=${futureWeek()}`)
  await expect(dayColumn(page)).toHaveCount(1)      // polls past the SSR week paint

  // Tap an empty slot → a one-hour draft anchored there (row 6 = 10:00).
  await tapRow(page, 6)
  await expect(main(page).getByRole('button', { name: 'Adjust end time' })).toBeVisible()
  await expect(draftBlock(page)).toContainText('10:00–11:00')

  // touch-action gate. The regression this catches — `touch-none` leaking onto a
  // container and killing page scrolling — is invisible to a programmatic
  // `scrollBy`, because touch-action only constrains BROWSER pan gestures. So it
  // is asserted on computed style, and asserted while the draft is mounted.
  const touchAction = (l: ReturnType<typeof main>) => l.evaluate((el) => getComputedStyle(el).touchAction)
  expect(await touchAction(draftBlock(page))).toBe('none')
  expect(await touchAction(main(page).getByRole('button', { name: 'Adjust start time' }))).toBe('none')
  expect(await touchAction(main(page).getByRole('button', { name: 'Adjust end time' }))).toBe('none')
  expect(await touchAction(main(page).locator('[data-day-col]'))).not.toBe('none')
  expect(await touchAction(main(page))).not.toBe('none')
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).touchAction)).not.toBe('none')
  expect(await page.evaluate(() => getComputedStyle(document.body).touchAction)).not.toBe('none')

  // Drag the END handle down two rows. The landing point is the MIDDLE of the
  // target row, not its top edge: the handle's centre sits exactly on a row
  // boundary, where a subpixel column offset could round the drop into the
  // neighbouring row and make this assertion flaky.
  const endHandle = main(page).getByRole('button', { name: 'Adjust end time' })
  const box = (await endHandle.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + 2 * ROW_PX_DAY + ROW_PX_DAY / 2, { steps: 8 })
  await page.mouse.up()
  await expect(draftBlock(page)).toContainText('10:00–12:00')

  // The draft's own primary is `Book this draft`, not `Book`: the dialog it opens
  // has a `Book` submit of its own and both are on screen at once.
  const dayText = (await dayLabel(page).textContent())!.trim()
  await main(page).getByRole('button', { name: 'Book this draft' }).click()
  const dlg = dialog(page)
  await expect(dlg).toBeVisible()
  await expect(dlg.getByText('confirm instantly')).toBeVisible()
  await dlg.getByLabel('Purpose', { exact: true }).fill('e2e touch draft')
  await dlg.getByRole('button', { name: 'Book', exact: true }).click()
  await expect(dlg.getByRole('button', { name: 'Add to calendar' })).toBeVisible()
  await dlg.getByRole('button', { name: 'Done' }).click()

  // The gate this test exists for: what persisted is the RESIZED draft — start at
  // the tapped row 6, end at 6 + the seed's 2 rows + the 2 dragged rows — on the
  // day the day bar was showing. Read back through `rangeToRows` so the assertion
  // uses the same TZDate math the app does rather than a re-derivation.
  const org = await db.organization.findFirstOrThrow()
  const b = await db.booking.findFirstOrThrow({ where: { equipmentId: eq.id } })
  const rows = rangeToRows(b.startsAt, b.endsAt, org.timezone)
  expect(rows.startRow).toBe(6)
  expect(rows.endRow).toBe(10)
  expect(format(new TZDate(b.startsAt, org.timezone), 'EEE d MMM')).toBe(dayText)
})

test('draft lifecycle: re-seed, cancel keeps, day switch discards, success clears', async ({ browser }) => {
  test.setTimeout(120_000)
  const page = await phonePage(browser)
  await runWizard(page)
  const eq = await db.equipment.create({ data: { name: 'Raman', approvalPolicy: 'NONE' } })
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto(`/booking/${eq.id}?week=${futureWeek()}`)
  await expect(dayColumn(page)).toHaveCount(1)

  await tapRow(page, 6)
  await expect(draftBlock(page)).toContainText('10:00–11:00')

  // Re-seed: tapping a DIFFERENT empty slot moves the draft there at the default
  // one hour — it never leaves a second draft behind.
  await tapRow(page, 2)
  await expect(draftBlock(page)).toHaveCount(1)
  await expect(draftBlock(page)).toContainText('08:00–09:00')

  // Cancelling the dialog KEEPS the draft (adjust the handles and retry).
  await main(page).getByRole('button', { name: 'Book this draft' }).click()
  await expect(dialog(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
  await expect(draftBlock(page)).toContainText('08:00–09:00')

  // Switching the visible day discards it — a draft belongs to one day, and this
  // interior step does NOT remount the component the way a week link does.
  await main(page).getByLabel('Next day').click()
  await expect(draftBlock(page)).toHaveCount(0)

  // A successful submit clears it, so the booked slot is not left under a draft.
  await tapRow(page, 6)
  await expect(draftBlock(page)).toContainText('10:00–11:00')
  await main(page).getByRole('button', { name: 'Book this draft' }).click()
  const dlg = dialog(page)
  await expect(dlg).toBeVisible()
  await dlg.getByLabel('Purpose', { exact: true }).fill('e2e draft lifecycle')
  await dlg.getByRole('button', { name: 'Book', exact: true }).click()
  await expect(dlg.getByRole('button', { name: 'Add to calendar' })).toBeVisible()
  await dlg.getByRole('button', { name: 'Done' }).click()
  await expect(draftBlock(page)).toHaveCount(0)
})

// ── T5: blocks are buttons — details modal + single-occurrence cancel ─────────
// Both tests seed their slot straight into the DB (a11y.spec.ts:180's shape):
// what is under test is the BLOCK, not another round of creating one. Rows 6→8
// put it at 10:00–11:00 org time, inside the 07:00–23:00 band and comfortably in
// the future, so `canCancel`'s future clause holds.

// The org-zone weekday of an instant as the day bar's own index (Monday = 0).
// Passed as `?day=`, so neither test depends on which weekday the +8d anchor
// happens to land on — the phone view opens on the seeded slot's day either way.
const orgDayIndex = (d: Date, timezone: string) => (new TZDate(d, timezone).getDay() + 6) % 7

// A future day resolved in ORG time (mobile.spec.ts:147's idiom), plus the rows
// that day's slot occupies. Returned together because the `?week=` anchor and the
// seeded instants must describe the same calendar day.
async function futureSlot(rowStart = 6, rowEnd = 8) {
  const org = await db.organization.findFirstOrThrow()
  const dateStr = format(new TZDate(new Date(Date.now() + 8 * 86_400_000), org.timezone), 'yyyy-MM-dd')
  const { start, end } = rowsToRange(dateStr, rowStart, rowEnd, org.timezone)
  return { dateStr, start, end, day: orgDayIndex(start, org.timezone) }
}

test('tapping a booking shows details and cancels it', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await phonePage(browser)
  await runWizard(page)
  const eq = await db.equipment.create({ data: { name: 'Raman', approvalPolicy: 'NONE' } })
  await signIn(page, ADMIN.email, ADMIN.password)

  const me = await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })
  const { dateStr, start, end, day } = await futureSlot()
  await db.booking.create({ data: { userId: me.id, equipmentId: eq.id, status: 'CONFIRMED', purpose: 'e2e block tap', startsAt: start, endsAt: end } })

  await page.goto(`/booking/${eq.id}?week=${dateStr}&day=${day}`)
  await expect(dayColumn(page)).toHaveCount(1)      // polls past the SSR week paint

  // The block is a real button now (it was `pointer-events-none` décor), and its
  // accessible name leads with the booker — ADMIN.name is 'Roland'.
  const block = main(page).getByRole('button', { name: /Roland/ })
  await expect(block).toHaveCount(1)
  await block.click()

  const details = page.getByRole('dialog', { name: 'Booking details' })
  await expect(details).toBeVisible()
  await expect(details.getByText('10:00–11:00')).toBeVisible()
  // Status is the WORD inside the Badge — never colour alone (§6).
  await expect(details.getByText('confirmed')).toBeVisible()

  // §4.3's 44px bar on the destructive primary — the one control on this phone
  // surface that must not be a mis-tap.
  const cancelBtn = details.getByRole('button', { name: 'Cancel booking' })
  expect((await cancelBtn.boundingBox())!.height).toBeGreaterThanOrEqual(44)

  // Registered BEFORE the click: Playwright auto-DISMISSES an unhandled dialog,
  // so window.confirm would silently refuse and this test would assert nothing.
  page.on('dialog', (d) => d.accept())
  await cancelBtn.click()

  // The modal closes and the refreshed schedule no longer carries the block —
  // cancelMyBookingAction revalidates /bookings only, so this is the modal's own
  // router.refresh() landing.
  await expect(details).toHaveCount(0)
  await expect(main(page).getByRole('button', { name: /Roland/ })).toHaveCount(0)
  expect((await db.booking.findFirstOrThrow({ where: { equipmentId: eq.id } })).status).toBe('CANCELLED')
})

test('maintenance blocks are read-only', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await phonePage(browser)
  await runWizard(page)
  const eq = await db.equipment.create({ data: { name: 'Raman', approvalPolicy: 'NONE' } })
  await signIn(page, ADMIN.email, ADMIN.password)

  const me = await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })
  const { dateStr, start, end, day } = await futureSlot()
  await db.maintenanceWindow.create({ data: { equipmentId: eq.id, startsAt: start, endsAt: end, reason: 'Laser service', createdById: me.id } })

  await page.goto(`/booking/${eq.id}?week=${dateStr}&day=${day}`)
  await expect(dayColumn(page)).toHaveCount(1)

  await main(page).getByRole('button', { name: /Laser service/ }).click()
  const details = page.getByRole('dialog', { name: 'Maintenance' })
  await expect(details).toBeVisible()
  await expect(details.getByText('Maintenance: Laser service')).toBeVisible()
  await expect(details.getByText('10:00–11:00')).toBeVisible()
  // A maintenance window is not a booking: no status chip, and no cancel path.
  await expect(details.getByRole('button', { name: 'Cancel booking' })).toHaveCount(0)
})

// ── T6: the global mobile systemics ───────────────────────────────────────────
// One test for the four app-wide changes that have no page of their own: the
// coarse-pointer 16px control rule, the viewport/safe-area meta, the auth shell's
// dvh, and the chat pane's corrected height calc.

// The a11y/redesign spec's channel flow, verbatim — a channel is just the fixture
// that puts the composer on screen.
async function createChannel(page: Page, name: string): Promise<void> {
  await page.goto('/chat')
  await page.getByRole('button', { name: 'Browse or create channels' }).click()
  await page.getByRole('button', { name: 'New channel' }).click()
  await page.getByPlaceholder('e.g. cvd-lab').fill(name)
  await page.getByRole('button', { name: 'Create channel', exact: true }).click()
  await page.waitForURL(/\/chat\/[^/]+$/)
}

test('mobile systemics: 16px inputs, viewport meta, chat composer above keyboard math', async ({ browser }) => {
  test.setTimeout(120_000)
  const page = await phonePage(browser)
  await runWizard(page)                                   // lands on /sign-in
  const eq = await db.equipment.create({ data: { name: 'Raman', approvalPolicy: 'NONE' } })
  // Seeded straight into the DB (a11y.spec.ts:180's shape): what is under test is
  // the title INPUT's computed size, not another round of creating an issue.
  const admin = await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })
  const issue = await db.issue.create({ data: { title: 'Systemics title', creatorId: admin.id, status: 'TODO', rank: 'a0' } })

  // The viewport tag is a root-layout export, so it is the same on every route.
  // `viewport-fit=cover` is what makes each env(safe-area-inset-*) term non-zero
  // on a notched device — the chat calc below subtracts two of them.
  const meta = await page.evaluate(() => document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '')
  expect(meta).toContain('viewport-fit=cover')
  // Pinch zoom is never locked out (WCAG 1.4.4): no scale cap ships in that tag.
  expect(meta).not.toContain('maximum-scale')
  expect(meta).not.toContain('user-scalable')

  // The auth shell is exactly one viewport tall. Headless Chromium has no
  // collapsing browser chrome, so 100vh and 100dvh measure identically here —
  // what this gates is that the arbitrary value COMPILES (Tailwind emits nothing
  // for a malformed one and min-height falls back to 0). The vh→dvh swap itself
  // is a real-device fix (100vh = the LARGEST viewport, so min-h-screen leaves
  // the sign-in card under the mobile browser chrome) that no emulated viewport
  // can observe.
  const authFit = await main(page).evaluate((el) => ({
    minHeight: getComputedStyle(el).minHeight,
    inner: `${window.innerHeight}px`,
  }))
  expect(authFit.minHeight).toBe(authFit.inner)

  await signIn(page, ADMIN.email, ADMIN.password)

  // Guard (test 1's): the 16px rule is `(pointer: coarse)`-gated, so a Playwright
  // drift that stops matching would make the assertions below vacuous.
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)

  // Any control under 16px triggers iOS Safari's zoom-on-focus. The rule is an
  // UNLAYERED element selector, which outranks Tailwind's layered text-* utilities
  // despite the lower specificity — assert on a <select> (13px by inheritance from
  // its text-sm label) and an <input>, the two shapes in the booking dialog.
  await page.goto(`/booking/${eq.id}?week=${futureWeek()}`)
  await main(page).getByRole('button', { name: 'New booking' }).click()
  const dlg = dialog(page)
  await expect(dlg).toBeVisible()
  const fontSize = (l: Locator) => l.evaluate((el) => getComputedStyle(el).fontSize)
  expect(await fontSize(dlg.getByRole('combobox', { name: 'From', exact: true }))).toBe('16px')
  expect(await fontSize(dlg.locator('input[placeholder*="growth"]'))).toBe('16px')
  await page.keyboard.press('Escape')
  await expect(dlg).toHaveCount(0)

  // …and the carve-out. 16px is iOS's zoom THRESHOLD, not a cap: a control the
  // type scale already sets LARGER keeps its size. The issue-title <input> is the
  // only such control in src today (text-2xl = 28px) and it is NOT an edit-mode
  // toggle — canEdit renders it by default, so capping it would have every admin
  // and member read the title at body size while guests get the 28px <h1>.
  await page.goto(`/issues/LAB-${issue.number}`)
  const titleInput = page.getByRole('textbox', { name: 'Issue title' })
  await expect(titleInput).toHaveValue('Systemics title')
  expect(await fontSize(titleInput)).toBe('28px')

  // The chat pane's height: viewport minus the REAL chrome — the h-12 header plus
  // <main>'s p-4 = 80px below md — plus safe-area insets that are 0 in Chromium.
  // The retired flat 7rem over-subtracted 32px. Asserted on the measured box, so a
  // malformed arbitrary value (Tailwind silently emits nothing) fails here rather
  // than shipping a content-sized pane.
  await createChannel(page, 'systemics')
  const shell = main(page).locator('> div').first()
  const geom = await shell.evaluate((el) => ({ h: el.getBoundingClientRect().height, inner: window.innerHeight }))
  expect(Math.abs(geom.h - (geom.inner - 80))).toBeLessThanOrEqual(2)

  // …and the composer that height exists to keep on screen at 375×812.
  const composer = page.getByRole('textbox', { name: 'Write a message' })
  await expect(composer).toBeVisible()
  await expect(composer).toBeInViewport()
  expect(await fontSize(composer)).toBe('16px')
})

// ── T8: the two dnd grips — touch-action + the board grip's hit target ────────
// Without `touch-action: none` the browser claims a touch drag as a pan before
// dnd-kit's PointerSensor ever sees it, so neither arrangement surface can be
// rearranged by finger. That is invisible to a synthetic pointer stream (as it
// is for the T4 draft handles), so it is asserted on COMPUTED STYLE — and the
// rule is grip-ONLY: the same declaration on a container would kill page
// scrolling, so <main> is asserted the other way on both surfaces.

test('dnd grips carry touch-action:none and meet the 24px target bar', async ({ browser }) => {
  test.setTimeout(120_000)
  const page = await phonePage(browser)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  const admin = await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })

  const touchAction = (l: Locator) => l.evaluate((el) => getComputedStyle(el).touchAction)
  const smallestSide = async (l: Locator) => { const b = (await l.boundingBox())!; return Math.min(b.width, b.height) }

  // /projects. Two cards, because a grid of one still renders the grip but says
  // nothing about ordering. `Project.rank` is NOT NULL with no default, so each
  // raw create supplies an explicit literal ('B' < 'C' byte-wise = the COLLATE
  // "C" order). Admin + no filter ⇒ the arrangement affordances render.
  await db.project.create({ data: { name: 'Grip alpha', rank: 'B' } })
  await db.project.create({ data: { name: 'Grip bravo', rank: 'C' } })
  await page.goto('/projects')
  const projectGrip = page.getByRole('button', { name: 'Reorder Grip alpha' })
  await expect(projectGrip).toBeVisible()
  expect(await touchAction(projectGrip)).toBe('none')
  expect(await smallestSide(projectGrip)).toBeGreaterThanOrEqual(24)
  expect(await touchAction(main(page))).not.toBe('none')

  // /issues board view, reached the way a11y.spec.ts:208-209 does — click the
  // View toggle's Board segment, then gate on the grip's own accessible name.
  // The identifier is DERIVED from the row rather than hardcoded (issues.spec.ts:58's
  // idiom): `wipe()` does restart `issue_number_seq`, so this is LAB-1 today, but the
  // gate then cannot drift if seeding ever changes. BACKLOG puts the card in the
  // leftmost column of the horizontally scrolling board, inside a 375px viewport.
  const issue = await db.issue.create({ data: { title: 'Grip issue', creatorId: admin.id, status: 'BACKLOG', rank: 'a0' } })
  await page.goto('/issues')
  await main(page).getByRole('button', { name: 'Board' }).click()
  const boardGrip = page.getByRole('button', { name: `Reorder LAB-${issue.number}` })
  await expect(boardGrip).toBeVisible()
  expect(await touchAction(boardGrip)).toBe('none')
  expect(await smallestSide(boardGrip)).toBeGreaterThanOrEqual(24)
  expect(await touchAction(main(page))).not.toBe('none')
})

// ── T7: rows & tables at 375px ────────────────────────────────────────────────
// The sweep's contract is negative — nothing on these surfaces may push the
// DOCUMENT wider than the viewport. Deliberately excluded: /booking/day, whose
// `min-w-[900px]` schedule is an intentional scroller (only its gutter freezes),
// and the cert matrix's own bounded `overflow-auto` box, which is why
// /certifications can carry a wide table and still pass.

// Long enough that the untruncated string cannot fit a 375px row: the issue title
// must truncate inside the row's `min-w-0`, and the project name must be ABSENT
// below md rather than merely clipped.
const LONG_PROJECT = 'Wafer-scale hBN uniformity programme'
const LONG_ISSUE = 'Chamber base pressure drifts above 5e-6 mbar after the turbo service, blocking every growth run'

// Everything the five audited routes need to render POPULATED (an EmptyState
// proves nothing about row overflow). Straight into the DB — the a11y.spec.ts:168
// seeding precedent — since what is under test is the layout, not the create paths.
async function seedRows() {
  const admin = await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })
  const project = await db.project.create({ data: { name: LONG_PROJECT, rank: 'B' } })
  await db.issue.create({ data: { title: LONG_ISSUE, creatorId: admin.id, status: 'TODO', rank: 'a0', projectId: project.id } })
  await db.equipment.create({ data: { name: 'Raman', approvalPolicy: 'NONE' } })
  await db.documentFolder.create({ data: { name: 'Standard operating procedures', createdById: admin.id } })
  await db.document.create({ data: { name: 'graphene transfer SOP.pdf', path: '/uploads/documents/t7.pdf', mime: 'application/pdf', size: 2048, uploaderId: admin.id, folderId: null } })
  await db.invitation.create({ data: { email: 'pending@lab.test', role: 'member', token: 't7-invite-token', invitedById: admin.id, expiresAt: new Date(Date.now() + 86_400_000) } })
  return admin
}

test('no horizontal overflow on core routes at 375px', async ({ browser }) => {
  test.setTimeout(120_000)
  const page = await phonePage(browser)
  await runWizard(page)
  await seedRows()
  await signIn(page, ADMIN.email, ADMIN.password)

  // Each route is gated on a LOAD-BEARING element (the seeded row, not the heading):
  // measuring scrollWidth against a skeleton would pass vacuously.
  const routes: [string, (p: Page) => Locator][] = [
    ['/issues', (p) => main(p).getByRole('link', { name: /LAB-\d+/ }).first()],
    ['/people', (p) => main(p).getByRole('heading', { name: 'Pending invitations' })],
    ['/certifications', (p) => main(p).locator('table input[type=checkbox]').first()],
    ['/dashboard', (p) => main(p).getByRole('heading', { name: /Welcome/ }).first()],
    ['/files', (p) => main(p).getByRole('link', { name: 'graphene transfer SOP.pdf' })],
  ]
  for (const [path, ready] of routes) {
    await page.goto(path)
    await expect(ready(page)).toBeVisible()
    const width = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(width, `${path} scrolls horizontally at ${PHONE.width}px`).toBeLessThanOrEqual(PHONE.width)
  }
})

test('issues list collapses to two lines below md', async ({ browser }) => {
  test.setTimeout(120_000)
  const phone = await phonePage(browser)
  await runWizard(phone)
  await seedRows()
  await signIn(phone, ADMIN.email, ADMIN.password)

  // The row is the focus target itself (issue-list-view.tsx:47 roving focus), so it
  // is located as `[role=listitem]` — the same handle the keyboard uses.
  await phone.goto('/issues')
  const row = main(phone).locator('[role=listitem]')
  await expect(row).toHaveCount(1)
  // Line 1 survives; the three md+ cells (labels, project, due) are display:none, so
  // the project name is absent rather than clipped — this is the collapse, not a
  // truncation. The title link is still on screen.
  await expect(row.getByRole('link', { name: /LAB-\d+/ })).toBeVisible()
  await expect(row.getByText(LONG_PROJECT)).toBeHidden()
  // …and the assignee, the one control the second line carries, stays reachable.
  await expect(row.getByRole('button', { name: 'Unassigned' })).toBeVisible()

  // The same row at desktop width is the historical 8-track grid: the project cell
  // is back. A second context (not a resize) so the SSR'd `md:` branch is what the
  // server rendered, exactly as a desktop user gets it.
  const desk = await desktopPage(browser)
  await signIn(desk, ADMIN.email, ADMIN.password)
  await desk.goto('/issues')
  await expect(main(desk).locator('[role=listitem]').getByText(LONG_PROJECT)).toBeVisible()
})
