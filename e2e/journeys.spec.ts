import { test, expect } from '@playwright/test'
import { db, wipe, runWizard, signIn, signOut, ADMIN, latestInviteToken, createMemberViaInvite, acceptInvite, waitForHydration } from './helpers'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async () => { await wipe() })

test('setup wizard creates org and admin, locks itself', async ({ page }) => {
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/dashboard') // v0.9.5 lands sign-in on /issues/me; the dashboard is still reachable
  await expect(page.getByRole('heading', { name: 'Welcome, Roland' }).first()).toBeVisible()
  await page.goto('/setup')
  await page.waitForURL('**/sign-in') // wizard refuses after completion
})

test('post-login landing is the personal task list, dashboard stays reachable', async ({ page }) => {
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password) // helper waits for the landing: /issues/me or /chat/<cid> (F7 last-opened)
  await expect(page).toHaveURL(/\/issues\/me$/)
  await expect(page.getByRole('heading', { name: 'My issues' })).toBeVisible()
  // /dashboard is not the landing but remains in the nav and directly reachable.
  await page.getByRole('link', { name: 'Dashboard' }).first().click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { name: 'Welcome, Roland' }).first()).toBeVisible()
})

test('invite → accept → first login as guest', async ({ page }) => {
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/people')
  await page.fill('input[name=email]', 'fyp@ntu.test')
  await page.selectOption('select[name=role]', 'guest')
  await page.click('button:has-text("Invite")')
  await expect(page.getByText('Invitation sent.')).toBeVisible()

  const token = await latestInviteToken('fyp@ntu.test')
  await signOut(page)
  await page.goto(`/accept-invite/${token}`)
  await page.fill('input[name=name]', 'FYP Student')
  await page.fill('input[name=password]', 'GuestPass!1234')
  await page.click('button:has-text("Create account")')
  await page.waitForURL('**/issues/me') // first-login landing = personal task list (v0.9.5)
  await page.goto('/dashboard') // dashboard still reachable — assert its welcome + guest nav there
  await expect(page.getByRole('heading', { name: 'Welcome, FYP Student' }).first()).toBeVisible()
  await expect(page.locator('nav')).not.toContainText('People') // guests see no admin nav
})

test('member books instantly via API-backed dialog flow', async ({ page }) => {
  await runWizard(page)
  const eq = await db.equipment.create({ data: { name: 'Raman', approvalPolicy: 'NONE' } })
  await signIn(page, ADMIN.email, ADMIN.password)
  // Navigate to next week so every visible day column is in the future
  // (drag-selecting a past slot would be blocked by the in_past policy rule).
  const nextWeek = new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10)
  await page.goto(`/booking/${eq.id}?week=${nextWeek}`)
  // drag a two-row selection on a future column. The calendar uses Pointer
  // events (onPointerDown/onPointerEnter/onPointerUp); stepped mouse moves make
  // Chromium dispatch the intermediate pointerenter events so the drag range
  // grows past the starting row.
  const cols = page.locator('div.relative.border-l')
  const col = cols.nth(2)
  const box = (await col.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 120)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + 165, { steps: 10 })
  await page.mouse.up()
  await expect(page.getByText('Book this slot')).toBeVisible()
  await expect(page.getByText('confirm instantly')).toBeVisible()
  await page.fill('input[placeholder*="growth"]', 'e2e run')
  // Dialog-scoped + exact: `:has-text()` is a case-insensitive SUBSTRING match and
  // `page.click(css)` is non-strict (first DOM match), so once the header grew a
  // `New booking` button — which precedes the non-portaled dialog in DOM order —
  // the old locator clicked the backdrop-covered header button and timed out.
  await page.getByRole('dialog', { name: 'Book this slot' }).getByRole('button', { name: 'Book', exact: true }).click()
  // SP5 Task 7: an instant confirm no longer closes the dialog — it swaps to a
  // "Booked — …" success state carrying the Add-to-calendar affordance. Assert that
  // confirmed-booking success state in-browser, then close it via Done.
  const dialog = page.getByRole('dialog', { name: 'Book this slot' })
  await expect(dialog.getByRole('button', { name: 'Add to calendar' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('Book this slot')).not.toBeVisible() // dialog closed
  // The header banner also renders the signed-in user's name, so scope the
  // assertion to <main> (the calendar) to hit the rendered booking block only.
  await expect(page.getByRole('main').getByText('Roland')).toBeVisible() // booking block rendered
})

test('guest booking goes to approval; admin approves; guest sees CONFIRMED', async ({ page }) => {
  await runWizard(page)
  const eq = await db.equipment.create({ data: { name: 'CVD Furnace', approvalPolicy: 'GUESTS' } })
  // create guest directly for speed
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/people')
  await page.fill('input[name=email]', 'guest@x.test')
  await page.selectOption('select[name=role]', 'guest')
  await page.click('button:has-text("Invite")')
  // Wait for the invite server action to finish writing the Invitation row
  // before reading its token straight from the DB (avoids a read-before-write race).
  await expect(page.getByText('Invitation sent.')).toBeVisible()
  const token = await latestInviteToken('guest@x.test')
  await signOut(page)
  await page.goto(`/accept-invite/${token}`)
  await page.fill('input[name=name]', 'Guest')
  await page.fill('input[name=password]', 'GuestPass!1234')
  await page.click('button:has-text("Create account")')
  await page.waitForURL('**/issues/me') // first-login landing = personal task list (v0.9.5)

  const starts = new Date(Date.now() + 24 * 3_600_000)
  const r = await page.request.post('/api/bookings', {
    data: { equipmentId: eq.id, startsAt: starts, endsAt: new Date(+starts + 2 * 3_600_000), purpose: 'fyp trial' },
  })
  expect(r.status()).toBe(201)
  expect((await r.json()).pending).toBe(true)

  await signOut(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/approvals')
  await expect(page.getByText('CVD Furnace')).toBeVisible()
  await page.click('button:has-text("Approve")')
  await expect(page.getByText('Nothing waiting on you')).toBeVisible()

  await signOut(page)
  await signIn(page, 'guest@x.test', 'GuestPass!1234')
  await page.goto('/bookings')
  await expect(page.getByText('confirmed')).toBeVisible()
})

test('certification gate blocks, then unlocks after granting', async ({ page }) => {
  await runWizard(page)
  const eq = await db.equipment.create({ data: { name: 'AFM', certificationRequired: true, approvalPolicy: 'NONE' } })
  await signIn(page, ADMIN.email, ADMIN.password)

  const starts = new Date(Date.now() + 24 * 3_600_000)
  const blocked = await page.request.post('/api/bookings', {
    data: { equipmentId: eq.id, startsAt: starts, endsAt: new Date(+starts + 3_600_000), purpose: 'x' },
  })
  expect(blocked.status()).toBe(422)

  await page.goto('/certifications')
  await waitForHydration(page)
  // The matrix checkbox is a controlled input: its checked state only flips
  // after the grant action runs and revalidatePath re-renders the page. That is
  // not optimistic, so Playwright's .check() (which asserts the state changed
  // synchronously) fails — dispatch a plain click and let toBeChecked() poll
  // until the server round-trip lands.
  await page.locator('table input[type=checkbox]').first().click()
  // W12-B: checking a cell now opens the Record-training dialog (defaults: today,
  // granting admin). Save → grantCertAction → revalidatePath flips the CONTROLLED
  // checkbox — still not optimistic, still poll-to-checked.
  const dialog = page.getByRole('dialog', { name: /Record training/ })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('table input[type=checkbox]').first()).toBeChecked()
  // The training history table lands beneath the matrix.
  await expect(page.getByRole('heading', { name: 'Training history' })).toBeVisible()
  const history = page.locator('section', { has: page.getByRole('heading', { name: 'Training history' }) })
  await expect(history.getByRole('cell', { name: 'Roland' }).first()).toBeVisible()

  const ok = await page.request.post('/api/bookings', {
    data: { equipmentId: eq.id, startsAt: starts, endsAt: new Date(+starts + 3_600_000), purpose: 'x' },
  })
  expect(ok.status()).toBe(201)
})

test('catalogue segments by certification and names the managers', async ({ page }) => {
  await runWizard(page)
  const admin = await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })
  const afm = await db.equipment.create({ data: { name: 'Atomic force microscope', certificationRequired: true, approvalPolicy: 'NONE' } })
  await db.equipment.create({ data: { name: 'Optical bench', approvalPolicy: 'NONE' } })
  // Roland manages the AFM — the name the "Needs certification" band has to surface,
  // turning "Ask an equipment manager" into someone the member can actually ask.
  await db.equipmentManager.create({ data: { userId: admin.id, equipmentId: afm.id } })

  // Run as a MEMBER. Certification is the one policy an admin does NOT bypass
  // (policy.ts:37), but the catalogue's job is the ordinary user's view of it.
  await signIn(page, ADMIN.email, ADMIN.password)
  const token = await createMemberViaInvite(page, 'catalogue@lab.test', 'member')
  await signOut(page)
  await acceptInvite(page, token, 'Mira', 'MemberPass!1234')

  await page.goto('/booking')
  // The sections carry no accessible name of their own, so each is scoped by the
  // heading it owns. Rooted at <main>: Next's dev SSR leaves a hidden duplicate of
  // the streamed tree in `div#S:0`, which a bare CSS locator would also match.
  const main = page.getByRole('main')
  const certification = main.locator('section', { has: page.getByRole('heading', { name: 'Needs certification' }) })
  const available = main.locator('section', { has: page.getByRole('heading', { name: 'Available to you' }) })
  await expect(certification.getByText('Atomic force microscope')).toBeVisible()
  await expect(certification.getByText('Ask an equipment manager to certify you.')).toBeVisible()
  await expect(certification.getByText('Roland')).toBeVisible() // the manager, named on the card
  await expect(available.getByText('Optical bench')).toBeVisible()

  // Granting the certification moves the instrument between bands — the segmentation
  // tracks what this viewer may actually book, not a static property of the machine.
  const member = await db.user.findFirstOrThrow({ where: { email: 'catalogue@lab.test' } })
  await db.certification.create({ data: { userId: member.id, equipmentId: afm.id, grantedById: admin.id } })
  await page.reload()
  await expect(available.getByText('Atomic force microscope')).toBeVisible()
  await expect(main.getByRole('heading', { name: 'Needs certification' })).toHaveCount(0)

  // The second naming site: the instrument's own Policy aside, which names the
  // managers whenever the instrument requires certification (granted or not).
  await page.goto(`/booking/${afm.id}`)
  const aside = main.locator('aside')
  await expect(aside.getByRole('heading', { name: 'Managers' })).toBeVisible()
  await expect(aside.getByText('Roland')).toBeVisible()
})

// W12-C: the usage-session journey on /bookings — log on (loose-visible button,
// server-gated window), note mid-session, log off through the prefilled modal.
// The slot straddles now (-30m/+60m) so it is Upcoming AND inside the log-on
// window; the row stays <li>→listitem and the modal's dialogs are located by
// their titles, so every press is scoped to the row or the dialog.
test('member logs a session on a booking (log on → note → log off)', async ({ page }) => {
  await runWizard(page)
  const eq = await db.equipment.create({ data: { name: 'PECVD', approvalPolicy: 'NONE' } })
  await signIn(page, ADMIN.email, ADMIN.password)
  const me = await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })
  await db.booking.create({ data: {
    userId: me.id, equipmentId: eq.id, status: 'CONFIRMED', purpose: 'session e2e',
    startsAt: new Date(Date.now() - 30 * 60_000), endsAt: new Date(Date.now() + 60 * 60_000),
  } })
  await page.goto('/bookings')
  await waitForHydration(page)
  const row = page.getByRole('listitem').filter({ hasText: 'PECVD' }).first()
  await row.getByRole('button', { name: 'Log on' }).click()
  await expect(row.getByRole('button', { name: 'Log off' })).toBeVisible()
  await row.getByRole('button', { name: 'Note' }).click()
  const note = page.getByRole('dialog', { name: 'Session note' })
  await note.locator('textarea').fill('stage heater acting up')
  await note.getByRole('button', { name: 'Save note' }).click()
  await expect(note).toHaveCount(0)
  await row.getByRole('button', { name: 'Log off' }).click()
  const off = page.getByRole('dialog', { name: 'Log off session' })
  await off.getByRole('button', { name: 'Save & log off' }).click()
  await expect(off).toHaveCount(0)
  await expect(row.getByText(/^Session:/)).toBeVisible()
  const after = await db.booking.findFirstOrThrow({ where: { equipmentId: eq.id } })
  expect(after.sessionStartedAt).not.toBeNull()
  expect(after.sessionEndedAt).not.toBeNull()
  expect(after.sessionNote).toContain('heater')
})
