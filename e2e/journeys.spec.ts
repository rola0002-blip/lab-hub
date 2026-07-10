import { test, expect } from '@playwright/test'
import { db, wipe, runWizard, signIn, signOut, ADMIN, latestInviteToken } from './helpers'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async () => { await wipe() })

test('setup wizard creates org and admin, locks itself', async ({ page }) => {
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  await expect(page.getByText('Welcome, Roland')).toBeVisible()
  await page.goto('/setup')
  await page.waitForURL('**/sign-in') // wizard refuses after completion
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
  await page.waitForURL('**/dashboard')
  await expect(page.getByText('Welcome, FYP Student')).toBeVisible()
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
  await page.click('button:has-text("Book")')
  await expect(page.getByText('Book this slot')).not.toBeVisible()
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
  await page.waitForURL('**/dashboard')

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
  await expect(page.getByText('Nothing pending')).toBeVisible()

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
  // The matrix checkbox is a controlled input: its checked state only flips
  // after toggleCertAction runs and revalidatePath re-renders the page. That is
  // not optimistic, so Playwright's .check() (which asserts the state changed
  // synchronously) fails — dispatch a plain click and let toBeChecked() poll
  // until the server round-trip lands.
  await page.locator('table input[type=checkbox]').first().click()
  await expect(page.locator('table input[type=checkbox]').first()).toBeChecked()

  const ok = await page.request.post('/api/bookings', {
    data: { equipmentId: eq.id, startsAt: starts, endsAt: new Date(+starts + 3_600_000), purpose: 'x' },
  })
  expect(ok.status()).toBe(201)
})
