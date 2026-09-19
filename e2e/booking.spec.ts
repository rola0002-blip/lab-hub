import { test, expect, type Browser, type Page } from '@playwright/test'
import { TZDate } from '@date-fns/tz'
import { addDays, format, startOfWeek } from 'date-fns'
import { db, wipe, runWizard, signIn, ADMIN, createMemberViaInvite, acceptInvite } from './helpers'
import { rowsToRange, type Band } from '@/features/booking/grid'

// v0.32.0 "access windows": the booking surfaces follow the equipment's daily
// window instead of the fixed 07:00–23:00 band. This suite owns the 24-hour
// journey — the admin form writes the window, a member books an overnight run
// (20:00 → 06:00 next day) through the dialog, and the block spans midnight on
// the week grid and /booking/day — plus the <24 h arm, where the dialog's time
// options cap to the window. (mobile.spec.ts pins the legacy 420/1380 window
// for its row math; the fixed-band history lives there.)
//
// Per-context client IP so better-auth's per-IP sign-in limit never trips. The
// other suites hold 10.10–10.91, so this file claims 10.92.x.
const FULL: Band = { startHour: 0, endHour: 24 }

let ipSeq = 0
async function newPage(browser: Browser): Promise<Page> {
  ipSeq += 1
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `10.92.${ipSeq}.7` } })
  return ctx.newPage()
}

const main = (page: Page) => page.getByRole('main')
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Book this slot' })

// The journeys shape: serial, wiped between tests, each test runs its own wizard.
test.describe.configure({ mode: 'serial' })
test.beforeEach(async () => { await wipe() })

test('admin sets the window; member books an overnight run that spans midnight', async ({ browser }) => {
  test.setTimeout(240_000)
  const adminPage = await newPage(browser)
  await runWizard(adminPage)
  // Seeded windowed (07:00–23:00) with a 12 h duration cap so the overnight leg
  // below clears max_duration on the 24 h window the admin is about to set.
  const eq = await db.equipment.create({
    data: { name: 'CVD Furnace', approvalPolicy: 'NONE', accessStartMinutes: 420, accessEndMinutes: 1380, maxDurationMinutes: 720 },
  })
  await signIn(adminPage, ADMIN.email, ADMIN.password)

  // ── Leg 1: the admin form edits the window through the UI ──────────────────
  await adminPage.goto(`/admin/equipment/${eq.id}`)
  const from = adminPage.getByRole('combobox', { name: 'Bookable from' })
  const until = adminPage.getByRole('combobox', { name: 'Bookable until' })
  // The stored 07:00–23:00 window renders in the two selects, unchecked 24 h.
  await expect(from).toHaveValue('420')
  await expect(until).toHaveValue('1380')
  await expect(from).toBeEnabled()
  // Narrow it to 08:00–22:00 and save.
  await from.selectOption('480')
  await until.selectOption('1320')
  await adminPage.getByRole('button', { name: 'Save' }).click()
  await adminPage.waitForURL('**/admin/equipment')
  let saved = await db.equipment.findUniqueOrThrow({ where: { id: eq.id } })
  expect(saved.accessStartMinutes).toBe(480)
  expect(saved.accessEndMinutes).toBe(1320)

  // The equipment page states the window where the policy bites.
  await adminPage.goto(`/booking/${eq.id}`)
  await expect(main(adminPage).getByText('Bookable 08:00–22:00 daily')).toBeVisible()

  // ── Leg 2: widen to 24 hours via the checkbox, which disables the selects ──
  await adminPage.goto(`/admin/equipment/${eq.id}`)
  await expect(from).toHaveValue('480')
  await adminPage.getByLabel('24 hours').check()
  await expect(from).toBeDisabled()
  await expect(until).toBeDisabled()
  await adminPage.getByRole('button', { name: 'Save' }).click()
  await adminPage.waitForURL('**/admin/equipment')
  saved = await db.equipment.findUniqueOrThrow({ where: { id: eq.id } })
  expect(saved.accessStartMinutes).toBe(0)
  expect(saved.accessEndMinutes).toBe(1439)

  // ── Leg 3: a member books 20:00 → 06:00 next day through the dialog ────────
  const token = await createMemberViaInvite(adminPage, 'night@lab.test', 'member')
  const page = await newPage(browser)
  await acceptInvite(page, token, 'Noor', 'MemberPass!1234')
  const org = await db.organization.findFirstOrThrow()
  // Tuesday of next week (mobile.spec.ts's +8d anchor): both the 20:00 start day
  // and the 06:00 end day sit mid-week, so the week grid below renders BOTH
  // slices in one view.
  const tue = addDays(startOfWeek(new TZDate(new Date(Date.now() + 8 * 86_400_000), org.timezone), { weekStartsOn: 1 }), 1)
  const dateStr = format(tue, 'yyyy-MM-dd')
  const wed = format(addDays(tue, 1), 'yyyy-MM-dd')

  await page.goto(`/booking/${eq.id}`)
  await main(page).getByRole('button', { name: 'New booking' }).click()
  const dlg = dialog(page)
  await expect(dlg).toBeVisible()
  await dlg.getByLabel('Date', { exact: true }).fill(dateStr)
  // Rows on the 0..24 band: 40 = 20:00, 60 = 06:00 next day — the To select's
  // past-midnight extension carrying the run across the day boundary.
  await dlg.getByRole('combobox', { name: 'From', exact: true }).selectOption('40')
  await dlg.getByRole('combobox', { name: 'To', exact: true }).selectOption('60')
  await expect(dlg.getByText('confirm instantly')).toBeVisible()
  await dlg.getByLabel('Purpose', { exact: true }).fill('overnight anneal')
  await dlg.getByRole('button', { name: 'Book', exact: true }).click()
  await expect(dlg.getByRole('button', { name: 'Add to calendar' })).toBeVisible()
  await dlg.getByRole('button', { name: 'Done' }).click()

  // The gate: what persisted is exactly 20:00 → 06:00+1d in ORG time.
  const { start, end } = rowsToRange(dateStr, 40, 60, org.timezone, FULL)
  const b = await db.booking.findFirstOrThrow({ where: { equipmentId: eq.id } })
  expect(b.startsAt.toISOString()).toBe(start.toISOString())
  expect(b.endsAt.toISOString()).toBe(end.toISOString())

  // ── The block spans midnight on the week grid: one slice on Tuesday's
  // column (20:00→24:00) and one on Wednesday's (00:00→06:00) — both carry the
  // same booking's accessible name.
  await page.goto(`/booking/${eq.id}?week=${dateStr}`)
  const block = main(page).getByRole('button', { name: /Noor · overnight anneal/ })
  await expect(block).toHaveCount(2)

  // …and both slices are visible in the day view, one date at a time.
  await page.goto(`/booking/day?date=${dateStr}`)
  await expect(main(page).getByText('Noor')).toBeVisible()
  await page.goto(`/booking/day?date=${wed}`)
  await expect(main(page).getByText('Noor')).toBeVisible()
})

test('a windowed instrument caps the dialog time options to its band', async ({ browser }) => {
  test.setTimeout(120_000)
  const page = await newPage(browser)
  await runWizard(page)
  const eq = await db.equipment.create({ data: { name: 'Raman', approvalPolicy: 'NONE', accessStartMinutes: 420, accessEndMinutes: 1380 } })
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto(`/booking/${eq.id}`)
  await expect(main(page).getByText('Bookable 07:00–23:00 daily')).toBeVisible()

  await main(page).getByRole('button', { name: 'New booking' }).click()
  const dlg = dialog(page)
  await expect(dlg).toBeVisible()
  // The From list offers only start times inside the window…
  const from = dlg.getByRole('combobox', { name: 'From', exact: true })
  const fromOpts = await from.locator('option').allTextContents()
  expect(fromOpts[0]).toBe('07:00')
  expect(fromOpts[fromOpts.length - 1]).toBe('22:30')
  expect(fromOpts).not.toContain('06:30')
  expect(fromOpts).not.toContain('23:00')
  // …while the To list still spans the whole same-day band (23:00 close) but,
  // with the 480-minute cap, never runs past midnight — the preview verdict,
  // not the select, is what refuses an over-cap range.
  await from.selectOption('0')
  const to = dlg.getByRole('combobox', { name: 'To', exact: true })
  const toOpts = await to.locator('option').allTextContents()
  expect(toOpts[0]).toBe('07:30')
  expect(toOpts).toContain('23:00')
  expect(toOpts).not.toContain('00:00')
  expect(toOpts).not.toContain('06:00')
  expect(toOpts[toOpts.length - 1]).toBe('23:00')
})
