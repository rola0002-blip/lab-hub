import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { db, wipe, runWizard, signIn, ADMIN, waitForHydration } from './helpers'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async () => { await wipe() })

// Task 8: the queue used to keep ONE shared `reason` string across every row, so a
// reason typed into request A's reject box silently rode along with request B's
// rejection (and any successful reject cleared every other row's draft). Rows are
// listitems scoped by equipment name — the journeys.spec.ts idiom — and the reject
// box is the row-scoped "Rejection reason" textbox; only one panel is open at a
// time, so "A still holds its draft" must be checked by re-opening A's panel.
test('rejecting one request does not leak its reason into another row', async ({ page }) => {
  await runWizard(page)
  const me = await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })
  const sem = await db.equipment.create({ data: { name: 'SEM', approvalPolicy: 'GUESTS' } })
  const tem = await db.equipment.create({ data: { name: 'TEM', approvalPolicy: 'GUESTS' } })
  const day = 24 * 3_600_000
  await db.booking.create({ data: {
    userId: me.id, equipmentId: sem.id, status: 'PENDING', purpose: 'oxide imaging',
    startsAt: new Date(Date.now() + day), endsAt: new Date(Date.now() + day + 2 * 3_600_000),
  } })
  await db.booking.create({ data: {
    userId: me.id, equipmentId: tem.id, status: 'PENDING', purpose: 'lamella prep',
    startsAt: new Date(Date.now() + 2 * day), endsAt: new Date(Date.now() + 2 * day + 2 * 3_600_000),
  } })

  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/approvals')
  await waitForHydration(page)
  const rowA = page.getByRole('listitem').filter({ hasText: 'SEM' })
  const rowB = page.getByRole('listitem').filter({ hasText: 'TEM' })
  await expect(rowA).toBeVisible()
  await expect(rowB).toBeVisible()

  // Draft a reason in row A's reject box, then open row B's (A's panel folds away —
  // `rejecting` tracks a single open row).
  await rowA.getByRole('button', { name: 'Reject…' }).click()
  await rowA.getByRole('textbox', { name: /reason/i }).fill('sample contaminated')
  await rowB.getByRole('button', { name: 'Reject…' }).click()

  // B's box must start empty: not A's text, and Confirm stays disabled so no stale
  // reason can be sent with B's rejection.
  const reasonB = rowB.getByRole('textbox', { name: /reason/i })
  await expect(reasonB).toHaveValue('')
  await expect(rowB.getByRole('button', { name: 'Confirm reject' })).toBeDisabled()

  // Reject B on its own reason; only B leaves the queue and only B's entry clears.
  await reasonB.fill('slot needed for service')
  await rowB.getByRole('button', { name: 'Confirm reject' }).click()
  await expect(rowB).toHaveCount(0)
  await expect(rowA).toBeVisible()
  const decided = await db.booking.findFirstOrThrow({ where: { equipmentId: tem.id } })
  expect(decided.status).toBe('REJECTED')
  expect(decided.rejectionReason).toBe('slot needed for service')

  // A's draft survives B's successful reject (the old shared clear-on-success wiped
  // it) — re-open A's panel to see the per-row state.
  await rowA.getByRole('button', { name: 'Reject…' }).click()
  await expect(rowA.getByRole('textbox', { name: /reason/i })).toHaveValue('sample contaminated')
})

// W20-D: the Approvals nav badge counts the queue's CARDS (a recurring series is
// one) and drops live as the admin decides — no reload. The dashboard banner
// uses the same unit. The requests belong to a PEER, not the admin: a decision
// notifies only the requester, so an admin-owned request would hand the admin's
// tab a `notif` SSE event that refreshes the badge on its own and mask a missing
// decider-side refreshNavCounts() (verified: it does).
test('the Approvals badge counts cards and drops live on decide', async ({ page }) => {
  await runWizard(page)
  const peer = await db.user.create({ data: { id: randomUUID(), name: 'Peer', email: 'w20-peer@lab.test', emailVerified: true, role: 'member' } })
  const sem = await db.equipment.create({ data: { name: 'SEM', approvalPolicy: 'GUESTS' } })
  const tem = await db.equipment.create({ data: { name: 'TEM', approvalPolicy: 'GUESTS' } })
  const day = 24 * 3_600_000
  await db.booking.create({ data: {
    userId: peer.id, equipmentId: sem.id, status: 'PENDING', purpose: 'single',
    startsAt: new Date(Date.now() + day), endsAt: new Date(Date.now() + day + 3_600_000),
  } })
  // Three PENDING occurrences of ONE series — one /approvals card, one badge unit.
  const rule = await db.recurrenceRule.create({ data: {
    equipmentId: tem.id, userId: peer.id, daysOfWeek: [1], startMinutes: 600, durationMinutes: 60,
    firstDate: '2026-11-02', untilDate: '2026-11-16',
  } })
  for (let i = 0; i < 3; i++) {
    await db.booking.create({ data: {
      userId: peer.id, equipmentId: tem.id, status: 'PENDING', purpose: 'series', recurrenceRuleId: rule.id,
      startsAt: new Date(Date.now() + (2 + 7 * i) * day), endsAt: new Date(Date.now() + (2 + 7 * i) * day + 3_600_000),
    } })
  }

  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/dashboard')
  await waitForHydration(page)
  // <Badge count> renders a span.rounded-full only when count > 0.
  const badge = page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /^Approvals/ }).locator('span.rounded-full')
  await expect(badge).toHaveText('2')
  await expect(page.getByRole('link', { name: /2 booking requests waiting for approval/ })).toBeVisible()

  await page.goto('/approvals')
  await waitForHydration(page)
  // A full page load would drop this sentinel: its survival proves the badge
  // moved through the client store, not a reload.
  await page.evaluate(() => { (window as unknown as { __noReload: boolean }).__noReload = true })
  await page.getByRole('listitem').filter({ hasText: 'SEM' }).getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(badge).toHaveText('1')
  await page.getByRole('listitem').filter({ hasText: 'TEM' }).getByRole('button', { name: 'Approve all', exact: true }).click()
  await expect(badge).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true)
})
