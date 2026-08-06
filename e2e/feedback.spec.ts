import { test, expect, type Browser, type Page } from '@playwright/test'
import { wipe, seedSystem, runWizard, signIn, ADMIN, createMemberViaInvite, acceptInvite, db } from './helpers'

// v0.13 "user feedback system" (spec §11.3): the round trip from the in-app composer to
// the admin's review queue and back to the author's bell. The journeys drive the two ways
// the composer is raised (the sidebar footer button and ⌘K), the guest divergence (guests
// CAN submit — unlike the issue composer), the role-adaptive /feedback route (a non-admin
// never receives queue data), the author-delete window (own item, while still New), the
// session gate on screenshot bytes, and the phone drawer hand-off.
//
// Per-context client IP so better-auth's per-IP sign-in/up limit never trips. Bands
// 10.10 / 10.20 / 10.30 / 10.40 / 10.41 / 10.50 / 10.60 / 10.70 / 10.80 are taken by the
// other suites, so this file claims 10.90.x and stays out of every other bucket.
let ipSeq = 0
const PHONE = { width: 375, height: 812 }
async function newPage(browser: Browser, viewport?: { width: number; height: number }): Promise<Page> {
  ipSeq += 1
  const ctx = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': `10.90.${ipSeq}.7` },
    ...(viewport ? { viewport } : {}),
  })
  return ctx.newPage()
}

// Serial + ONE-TIME wipe/seed: test 1 provisions the org, the admin, the member and the
// guest (workers:1 → one shared database); the later tests only sign in. NEVER a
// beforeEach(wipe) — that would truncate `user` between tests and every later signIn
// would hang. seedSystem() reinstalls the bot + #lab-updates rows so the sign-up
// after-hook's best-effort auto-join has something to join (feedback itself never
// announces — spec §6.5 — so nothing here depends on the bot).
test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => { await wipe(); await seedSystem() })

// Single-word display names throughout: <Avatar> derives its background hue from the
// RANDOM better-auth user id, and a one-letter monogram is the only length axe-core
// treats as "too short to judge" — see the determinism note in e2e/a11y.spec.ts.
const MEMBER = { email: 'member@lab.test', name: 'Mira', pass: 'MemberPass!1234' }
const GUEST = { email: 'guest@lab.test', name: 'Guesty', pass: 'GuestPass!1234' }

const BUG_BODY = 'The booking grid shows an extra hour after the clocks change.'
const IDEA_BODY = 'Let the calendar feed carry the instrument location.'
const ADMIN_BODY = 'Screenshot bytes should never be readable without a session.'

// A real 1x1 PNG: saveUpload trusts the declared mime, but the uploads route serves the
// stored bytes back and journey 5 asserts the image content-type, so send genuine ones.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

// Feedback cards are <li> rows; the body text is unique per report, so this survives the
// queue and "My feedback" rendering the same item with different affordances. Role-based,
// so Next's hidden dev-SSR duplicate tree (div#S:0) never doubles the match.
const cardWith = (page: Page, body: string) => page.getByRole('listitem').filter({ hasText: body })
const queueHeading = (page: Page) => page.getByRole('heading', { name: 'Review queue' })
const composer = (page: Page) => page.getByRole('dialog', { name: 'Give feedback' })

// Fill and send the composer. `attach` rides the sr-only <input type=file> directly — the
// visible control is the wrapping <label>, which has no files to set.
async function sendFeedback(page: Page, kind: 'Bug' | 'Idea', body: string, attach?: string) {
  const d = composer(page)
  await expect(d).toBeVisible()
  await d.getByRole('button', { name: kind }).click()
  await expect(d.getByRole('button', { name: kind })).toHaveAttribute('aria-pressed', 'true')
  await d.getByLabel('Details').fill(body)
  if (attach) {
    await d.locator('input[type=file]').setInputFiles({ name: attach, mimeType: 'image/png', buffer: PNG })
    await expect(d.getByRole('button', { name: 'Remove screenshot' })).toBeVisible()
  }
  await d.getByRole('button', { name: 'Send feedback' }).click()
  // The store closes the composer only after a 201, so its disappearance IS the success
  // signal; the toast is the user-visible half of the same event.
  await expect(d).toHaveCount(0)
  // Filtered, not bare: the app shell also mounts an sr-only role="status" live region
  // (#live-status), so `getByRole('status')` alone is strict-mode ambiguous.
  await expect(page.getByRole('status').filter({ hasText: 'your feedback is in' })).toBeVisible()
}

// ─────────────────────────────────────────────────────────────────────────────
test('1: a member sends a bug with a screenshot from the sidebar and finds it on /feedback', async ({ browser }) => {
  test.setTimeout(150_000)
  const page = await newPage(browser)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)

  // Both non-admins are provisioned here (serial file, one shared database): the guest's
  // account is what journey 2 signs into.
  const memberToken = await createMemberViaInvite(page, MEMBER.email, 'member')
  const guestToken = await createMemberViaInvite(page, GUEST.email, 'guest')
  const mp = await newPage(browser)
  await acceptInvite(mp, memberToken, MEMBER.name, MEMBER.pass)
  const gp = await newPage(browser)
  await acceptInvite(gp, guestToken, GUEST.name, GUEST.pass)
  await gp.context().close()

  // The composer records the page it was raised from, so raise it from a real surface.
  await mp.goto('/booking')
  await expect(mp.getByRole('heading', { name: 'Equipment' }).first()).toBeVisible()
  await mp.getByRole('button', { name: 'Give feedback' }).click()
  await sendFeedback(mp, 'Bug', BUG_BODY, 'booking-grid.png')

  await mp.goto('/feedback')
  await expect(mp.getByRole('heading', { name: 'My feedback' })).toBeVisible()
  // A member never receives queue data at all (the page fetches it only for an admin).
  await expect(queueHeading(mp)).toHaveCount(0)
  const card = cardWith(mp, BUG_BODY)
  await expect(card).toContainText('Bug')
  await expect(card).toContainText('New')
  // The context line is the invisible payload made visible: version · path · UA.
  await expect(card).toContainText('/booking')
  await expect(card.getByRole('img')).toBeVisible() // the screenshot thumbnail

  await mp.context().close()
  await page.context().close()
})

// ─────────────────────────────────────────────────────────────────────────────
test('2: a guest raises the composer from the command palette and sends an idea', async ({ browser }) => {
  test.setTimeout(150_000)
  const gp = await newPage(browser)
  await signIn(gp, GUEST.email, GUEST.pass)

  // Retry the one-shot keypress until the dialog appears (it can fire a frame before the
  // listener is bound) — the a11y suite's proven idiom.
  const palette = gp.getByRole('dialog', { name: 'Command palette' })
  await expect(async () => {
    await gp.keyboard.press('ControlOrMeta+k')
    await expect(palette).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10_000 })
  // Scoped to the palette: /issues/me behind it carries five filter <select>s, which are
  // comboboxes too.
  await palette.getByRole('combobox').fill('feedback')
  // "Give feedback" is the COMMAND row (the /feedback page row reads "Feedback Workspace"),
  // and it is registered for every role — the deliberate divergence from "Create issue".
  await palette.getByRole('option', { name: /Give feedback/ }).click()
  await sendFeedback(gp, 'Idea', IDEA_BODY)

  await gp.goto('/feedback')
  const card = cardWith(gp, IDEA_BODY)
  await expect(card).toContainText('Idea')
  await expect(card).toContainText('New')
  // A guest submits like anyone else but reviews nothing.
  await expect(queueHeading(gp)).toHaveCount(0)
  await expect(gp.getByRole('heading', { name: 'My feedback' })).toBeVisible()

  await gp.context().close()
})

// ─────────────────────────────────────────────────────────────────────────────
test('3: the admin queue filters by type, a decision leaves the New view, and the author is belled', async ({ browser }) => {
  test.setTimeout(180_000)
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)

  // Fan-out (spec §6.4): every OTHER admin is belled on submission. Opening the tray marks
  // the rows read, so assert before touching the queue.
  await page.getByRole('button', { name: 'Notifications' }).click()
  await expect(page.getByText(`New feedback from ${MEMBER.name}`)).toBeVisible()
  await expect(page.getByText(`New feedback from ${GUEST.name}`)).toBeVisible()

  // (The tray has no Escape handler — the navigation is what dismisses it.)
  await page.goto('/feedback')
  await expect(queueHeading(page)).toBeVisible()
  // Default view = status New, type All: both submissions are still untriaged.
  await expect(cardWith(page, BUG_BODY)).toBeVisible()
  await expect(cardWith(page, IDEA_BODY)).toBeVisible()

  // Type filter narrows client-side (the whole queue is already in hand).
  await page.getByRole('group', { name: 'Filter by type' }).getByRole('button', { name: 'Ideas' }).click()
  await expect(cardWith(page, BUG_BODY)).toHaveCount(0)
  await expect(cardWith(page, IDEA_BODY)).toBeVisible()

  // Triage the GUEST's idea. The trigger's accessible name carries the author, which is
  // what makes it addressable while two reports are on screen.
  await page.getByRole('button', { name: `Change status of feedback from ${GUEST.name}` }).click()
  await page.getByRole('menu').getByRole('menuitem', { name: 'Planned' }).click()
  // New is the default status filter, so a just-triaged item leaves the visible queue —
  // and with nothing else matching, the FILTER's own empty state appears (never the
  // page-level "No feedback yet", which would be a lie above a non-empty queue).
  await expect(cardWith(page, IDEA_BODY)).toHaveCount(0)
  await expect(page.getByText('No feedback matches these filters')).toBeVisible()
  expect((await db.feedback.findFirstOrThrow({ where: { body: IDEA_BODY } })).status).toBe('PLANNED')

  // The author is belled on a DECISION (REVIEWED and same-status writes never bell), and
  // the row lands on /feedback — feedback_* has no deep link.
  const gp = await newPage(browser)
  await signIn(gp, GUEST.email, GUEST.pass)
  await gp.getByRole('button', { name: 'Notifications' }).click()
  const row = gp.getByRole('link', { name: /Your feedback was marked Planned/ })
  await expect(row).toBeVisible()
  await row.click()
  await expect(gp).toHaveURL(/\/feedback$/)
  await expect(cardWith(gp, IDEA_BODY)).toContainText('Planned')

  await gp.context().close()
  await page.context().close()
})

// ─────────────────────────────────────────────────────────────────────────────
test('4: the author deletes their own New report; a decided one offers the author no delete', async ({ browser }) => {
  test.setTimeout(150_000)
  const mp = await newPage(browser)
  await signIn(mp, MEMBER.email, MEMBER.pass)

  // Captured before the delete: the row is gone afterwards, and the unlinked file is the
  // half of the cascade the database cannot show.
  const before = await db.feedback.findFirstOrThrow({ where: { body: BUG_BODY } })
  expect(before.screenshotPath).toBeTruthy()

  await mp.goto('/feedback')
  const card = cardWith(mp, BUG_BODY)
  // Two-step confirm, in place (no modal): the trigger swaps for Delete + Cancel.
  await card.getByRole('button', { name: 'Delete feedback' }).click()
  await expect(card).toContainText('Delete this permanently?')
  await card.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(cardWith(mp, BUG_BODY)).toHaveCount(0)
  expect(await db.feedback.count({ where: { body: BUG_BODY } })).toBe(0)
  // Best-effort unlink really ran: the bytes are gone, so the still-authenticated read
  // 404s rather than serving an orphan.
  expect((await mp.request.get(before.screenshotPath!)).status()).toBe(404)

  // Once review has started the item is part of the record: only an admin may remove it.
  const gp = await newPage(browser)
  await signIn(gp, GUEST.email, GUEST.pass)
  await gp.goto('/feedback')
  const gcard = cardWith(gp, IDEA_BODY)
  await expect(gcard).toContainText('Planned')
  await expect(gcard.getByRole('button', { name: 'Delete feedback' })).toHaveCount(0)

  await gp.context().close()
  await mp.context().close()
})

// ─────────────────────────────────────────────────────────────────────────────
test('5: a feedback screenshot is session-gated — 401 signed out, 200 signed in', async ({ browser }) => {
  test.setTimeout(150_000)
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)

  // Journey 4 deleted the only screenshot-bearing report (and its file), so mint a fresh
  // one here rather than depending on a row an earlier journey is designed to destroy.
  await page.goto('/feedback')
  await page.getByRole('button', { name: 'Give feedback' }).click()
  await sendFeedback(page, 'Bug', ADMIN_BODY, 'gate.png')
  const saved = await db.feedback.findFirstOrThrow({ where: { body: ADMIN_BODY } })
  const url = saved.screenshotPath!
  expect(url.startsWith('/uploads/feedback/')).toBe(true)

  // Signed in: the bytes come back as an image that no shared cache may retain.
  const ok = await page.request.get(url)
  expect(ok.status()).toBe(200)
  expect(ok.headers()['content-type']).toBe('image/png')
  expect(ok.headers()['cache-control']).toBe('private, no-store')
  expect(ok.headers()['x-content-type-options']).toBe('nosniff')

  // Signed out: a brand-new context carries no session cookie at all.
  const anon = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.90.199.7' } })
  expect((await anon.request.get(url)).status()).toBe(401)
  await anon.close()

  await page.context().close()
})

// ─────────────────────────────────────────────────────────────────────────────
test('6: on a phone the drawer hands off to the composer — drawer closed, focus inside the dialog', async ({ browser }) => {
  test.setTimeout(150_000)
  const page = await newPage(browser, PHONE)
  await signIn(page, MEMBER.email, MEMBER.pass)
  await page.goto('/dashboard')

  const drawer = page.getByRole('dialog', { name: 'Navigation' })
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(drawer).toBeVisible()
  await expect(page.locator('#app-content')).toHaveAttribute('inert', '')

  // The footer button carries data-close-nav precisely because it is NOT a nav link: it
  // raises a modal with its own focus trap, and leaving the drawer's trap alive under it
  // would break both. Scoped to the drawer — the md+ copy of the rail is still in the DOM.
  await drawer.getByRole('button', { name: 'Give feedback' }).click()
  await expect(drawer).toBeHidden()
  await expect(composer(page)).toBeVisible()
  // The drawer's cleanup cleared `inert` (otherwise the composer sits over a dead shell)…
  await expect(page.locator('#app-content')).not.toHaveAttribute('inert', '')
  // …and focus is INSIDE the composer, not restored to the hamburger behind it.
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"][aria-modal="true"]')))
    .toBe(true)

  await page.keyboard.press('Escape')
  await expect(composer(page)).toHaveCount(0)
  await page.context().close()
})
