import { test, expect, type Browser, type Page, type Locator } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { wipe, seedSystem, runWizard, signIn, waitForHydration, ADMIN, db } from './helpers'

// v0.32 Task 11 — the unified ConfirmDialog. Every destructive confirm that was
// a native window.confirm() (and the bespoke files delete Modal) now renders the
// styled dialog over the generic <Modal>: focus trap, Escape, backdrop click.
// One journey per pattern family — booking cancel (bookings-client row) and
// file delete (files-client) — asserting the dialog's aria, that focus lands
// INSIDE it (on the safe dismiss arm), and that both arms work; plus an axe
// pass with a dialog open (both themes, the a11y.spec idiom).
// Task 12 additions: modal initial focus (heading), the toast single-live-region
// shape, and the Past bookings server-side Load more.

// Per-context client IP so better-auth's per-IP sign-in rate limit never trips
// (mirrors the other serial suites); a distinct 10.60.x band avoids collisions.
// reducedMotion: the a11y.spec rationale — the globals.css reduced-motion reset
// zeroes transition durations, so the row's hover:bg-hover fade lands on its
// final colour immediately and the axe pass below never samples a mid-fade
// intermediate (the pointer is parked off the row before the audit).
let ipSeq = 0
async function newPage(browser: Browser): Promise<Page> {
  ipSeq += 1
  const ctx = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': `10.60.${ipSeq}.7` },
    reducedMotion: 'reduce',
  })
  return ctx.newPage()
}

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => { await wipe(); await seedSystem() })

const PDF = Buffer.from('%PDF-1.4\n%COLOSSUS v032 confirm\n', 'utf8')

// The dialog's accessible identity: role=dialog named by its title (the Modal's
// aria-labelledby wiring). Scope every button lookup to the dialog itself — the
// surface behind it can carry a same-named trigger (the row's "Cancel").
function confirmDialog(page: Page, title: string) {
  return page.getByRole('dialog', { name: title })
}

async function focusIsIn(locator: Locator): Promise<boolean> {
  const handle = await locator.elementHandle()
  if (!handle) return false
  return handle.evaluate((el) => el.contains(document.activeElement))
}

test('booking cancel: styled ConfirmDialog renders, focus is trapped, both arms work', async ({ browser }) => {
  const page = await newPage(browser)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  const me = await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })
  const eq = await db.equipment.create({ data: { name: 'ConfirmoScope', approvalPolicy: 'NONE' } })
  await db.booking.create({ data: {
    userId: me.id, equipmentId: eq.id, status: 'CONFIRMED', purpose: 'confirm dialog journey',
    startsAt: new Date(Date.now() + 24 * 3_600_000), endsAt: new Date(Date.now() + 25 * 3_600_000),
  } })
  await page.goto('/bookings')
  await waitForHydration(page)
  const row = page.getByRole('listitem').filter({ hasText: 'ConfirmoScope' })

  // Dismiss arm first: the dialog opens over the row and focus lands on the
  // SAFE button (Keep booking), never on the destructive one.
  await row.getByRole('button', { name: 'Cancel', exact: true }).click()
  const dlg = confirmDialog(page, 'Cancel this booking?')
  await expect(dlg).toBeVisible()
  await expect(dlg).toHaveAttribute('aria-modal', 'true')
  // The dismiss arm receives focus one rAF after mount (ConfirmDialog's own
  // effect defers past the Modal's focus trap), so the check polls.
  await expect.poll(() => focusIsIn(dlg.getByRole('button', { name: 'Keep booking' }))).toBe(true)
  await dlg.getByRole('button', { name: 'Keep booking' }).click()
  await expect(dlg).toHaveCount(0)
  expect((await db.booking.findFirstOrThrow({ where: { equipmentId: eq.id } })).status).toBe('CONFIRMED')

  // Confirm arm: the booking is cancelled and the row says so.
  await row.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dlg).toBeVisible()
  await dlg.getByRole('button', { name: 'Cancel booking' }).click()
  await expect(dlg).toHaveCount(0)
  await expect(row.getByText('cancelled')).toBeVisible()
  expect((await db.booking.findFirstOrThrow({ where: { equipmentId: eq.id } })).status).toBe('CANCELLED')
  await page.context().close()
})

test('file delete: styled ConfirmDialog renders, focus is trapped, both arms work', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/files')
  await waitForHydration(page)
  const DOC = 'confirm me.pdf'
  await page.locator('input[type=file]').first().setInputFiles({ name: DOC, mimeType: 'application/pdf', buffer: PDF })
  await expect(page.getByRole('link', { name: DOC })).toBeVisible()

  // Dismiss arm: the file survives.
  await page.getByRole('button', { name: `File ${DOC} actions` }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  const dlg = confirmDialog(page, 'Delete file?')
  await expect(dlg).toBeVisible()
  await expect(dlg).toHaveAttribute('aria-modal', 'true')
  // v0.32 copy contract: the warning names the version count that goes with it.
  await expect(dlg).toContainText(`Delete ${DOC} and its 1 version? This cannot be undone.`)
  await expect.poll(() => focusIsIn(dlg.getByRole('button', { name: 'Cancel' }))).toBe(true)
  await dlg.getByRole('button', { name: 'Cancel' }).click()
  await expect(dlg).toHaveCount(0)
  await expect(page.getByRole('link', { name: DOC })).toBeVisible()

  // Confirm arm: the file is gone.
  await page.getByRole('button', { name: `File ${DOC} actions` }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(dlg).toBeVisible()
  await dlg.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(dlg).toHaveCount(0)
  await expect(page.getByRole('link', { name: DOC })).toHaveCount(0)
  await page.context().close()
})

// axe with the dialog OPEN, both themes (a11y.spec's auditBothThemes idiom,
// inlined: that helper is file-local). /bookings carries no bg-accent fill, so
// the accent-tolerance machinery of a11y.spec is not needed here. The dialog's
// own danger fill (white on --color-danger) clears 4.5:1 on both canvases.
async function auditBothThemes(page: Page, where: string) {
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t
      try { localStorage.setItem('theme', t) } catch { /* private mode */ }
      return new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    }, theme)
    const { violations } = await new AxeBuilder({ page }).analyze()
    const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    const summary = bad.map((v) => `${v.id}[${v.impact}]×${v.nodes.length}: ${v.nodes.map((n) => `${n.target.join('>')} :: ${JSON.stringify(n.any?.map((c) => c.data))}`).join(' | ')}`).join(', ') || 'none'
    expect(bad, `${where} (${theme}) serious/critical: ${summary}`).toEqual([])
  }
}

test('axe: a surface with the ConfirmDialog open stays clean in both themes', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  const me = await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })
  const eq = await db.equipment.create({ data: { name: 'AxeConfirm', approvalPolicy: 'NONE' } })
  await db.booking.create({ data: {
    userId: me.id, equipmentId: eq.id, status: 'CONFIRMED', purpose: 'axe confirm',
    startsAt: new Date(Date.now() + 48 * 3_600_000), endsAt: new Date(Date.now() + 49 * 3_600_000),
  } })
  await page.goto('/bookings')
  await waitForHydration(page)
  const row = page.getByRole('listitem').filter({ hasText: 'AxeConfirm' })
  // Keyboard-only activation: a mouse click would park the pointer on the row,
  // whose hover:bg-hover fill under --text-danger text is a PRE-EXISTING 4.38:1
  // pair (flagged in the task report) — and the hover state sticks through the
  // modal backdrop, so no amount of mouse.move() recovers a settled row. This
  // audit is about the dialog itself; the keyboard path keeps the page
  // un-hovered deterministically (and doubles as the keyboard-reachability check).
  await row.getByRole('button', { name: 'Cancel', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(confirmDialog(page, 'Cancel this booking?')).toBeVisible()
  await auditBothThemes(page, 'confirm-dialog-open')
  await page.context().close()
})

// Task 12 — a Modal with no autoFocus field opens on its HEADING (tabIndex -1,
// the trap's new preferred element): screen readers announce the dialog's name,
// and the Close button is no longer the opening focus. Composer modals that
// autoFocus an input keep that field (the trap yields to in-dialog focus).
test('modal: initial focus lands on the dialog heading', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/dashboard')
  await waitForHydration(page)
  await page.getByRole('button', { name: 'Give feedback' }).click()
  const dlg = page.getByRole('dialog', { name: 'Give feedback' })
  await expect(dlg).toBeVisible()
  await expect(dlg.getByRole('heading', { name: 'Give feedback' })).toBeFocused()
  // Closed per pick (its own Close control), never a global Escape.
  await dlg.getByRole('button', { name: 'Close' }).click()
  await expect(dlg).toHaveCount(0)
  await page.context().close()
})

// Task 12 — toasts announce through exactly ONE polite live region: the host
// container. A per-toast role="status" nested a second live region inside it
// (double announcements in some screen readers), so the toast node itself must
// carry no role. Triggered via the create-issue composer's empty-title guard,
// which also proves the autoFocus title field kept its focus through the trap.
test('toast: single polite live region, no nested role=status', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/issues')
  await waitForHydration(page)
  await page.getByRole('button', { name: 'New issue' }).first().click()
  const dlg = page.getByRole('dialog', { name: 'New issue' })
  await expect(dlg).toBeVisible()
  await expect(dlg.getByRole('textbox', { name: 'Issue title' })).toBeFocused()
  await dlg.getByRole('button', { name: 'Create issue', exact: true }).click()
  const msg = page.getByText('Enter a title.', { exact: true })
  await expect(msg).toBeVisible()
  // The nearest aria-live ancestor is the host container — polite, and there is
  // NO second live region above it (nested regions would re-announce the text).
  await expect(msg.locator('xpath=ancestor::*[@aria-live="polite"][1]')).toHaveAttribute('aria-live', 'polite')
  await expect(msg.locator('xpath=ancestor::*[@aria-live="polite"][2]')).toHaveCount(0)
  // And the toast node itself is not a status region.
  await expect(page.getByRole('status').filter({ hasText: 'Enter a title.' })).toHaveCount(0)
  await page.context().close()
})

// Task 12 — the Past list paginates server-side via ?past=<n> (default 30,
// step +30, cap 365; no client state). 31 seeded past bookings render the
// first 30 plus a Load more link; following it re-fetches with take 60, shows
// all 31, and the link disappears (a short page IS the end of the list).
test('bookings: past list Load more steps ?past', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  const me = await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })
  // Serial spec, one shared DB: Task 11's cancelled ConfirmoScope still sits in
  // Past and would take one of the 30 slots — clear the table so the counts
  // below are exactly the seeds'.
  await db.booking.deleteMany({})
  const eq = await db.equipment.create({ data: { name: 'PastScope', approvalPolicy: 'NONE' } })
  await db.booking.createMany({ data: Array.from({ length: 31 }, (_, i) => ({
    userId: me.id, equipmentId: eq.id, status: 'CONFIRMED', purpose: `past ${i}`,
    startsAt: new Date(Date.now() - (i + 2) * 3_600_000), endsAt: new Date(Date.now() - (i + 2) * 3_600_000 + 1_800_000),
  })) })
  await page.goto('/bookings')
  await waitForHydration(page)
  const rows = page.getByRole('listitem').filter({ hasText: 'PastScope' })
  await expect(rows).toHaveCount(30)
  const more = page.getByRole('link', { name: 'Load more' })
  await expect(more).toHaveAttribute('href', '/bookings?past=60')
  await more.click()
  await page.waitForURL('**/bookings?past=60')
  await expect(rows).toHaveCount(31)
  await expect(more).toHaveCount(0)
  await page.context().close()
})
