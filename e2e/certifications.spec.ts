import { randomUUID } from 'node:crypto'
import { test, expect, type Browser, type Page } from '@playwright/test'
import { db, wipe, runWizard, createMemberViaInvite, acceptInvite, waitForHydration } from './helpers'

// v0.32 Task 7: the training-request UI. A member blocked by the certification
// gate asks for training from the equipment page (and sees the affordance in the
// booking dialog's blocked banner); on an unmanaged instrument an admin (the W21-A fallback) decides under Certifications →
// Requests; the grant flips the member's matrix cell and rings their bell.
//
// Per-context client IP so better-auth's per-IP sign-in limit never trips. The
// other suites hold 10.10–10.92, so this file claims 10.93.x.
let ipSeq = 0
async function newPage(browser: Browser): Promise<Page> {
  ipSeq += 1
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `10.93.${ipSeq}.7` } })
  return ctx.newPage()
}

const main = (page: Page) => page.getByRole('main')

test.describe.configure({ mode: 'serial' })
test.beforeEach(async () => { await wipe() })

test('member requests training; admin grants; matrix flips and member is notified', async ({ browser }) => {
  test.setTimeout(240_000)
  const adminPage = await newPage(browser)
  await runWizard(adminPage)
  const eq = await db.equipment.create({ data: { name: 'CVD Furnace', certificationRequired: true, approvalPolicy: 'NONE' } })
  const token = await createMemberViaInvite(adminPage, 'noor@lab.test', 'member')

  const page = await newPage(browser)
  await acceptInvite(page, token, 'Noor', 'MemberPass!1234')

  // ── The equipment page offers the ask beside the rule that bites ────────────
  await page.goto(`/booking/${eq.id}`)
  await waitForHydration(page)
  const askAside = main(page).getByRole('button', { name: 'Request training' })
  await expect(askAside).toBeVisible()

  // The booking dialog's blocked banner carries the same affordance (the preview
  // verdict is certification_required) — asserted, then dismissed; the aside is
  // the path the journey submits through below.
  await main(page).getByRole('button', { name: 'New booking' }).click()
  const dlg = page.getByRole('dialog', { name: 'Book this slot' })
  await expect(dlg).toBeVisible()
  await expect(dlg.getByText('You must be certified on this instrument before booking.')).toBeVisible()
  await expect(dlg.getByRole('button', { name: 'Request training' })).toBeVisible()
  await dlg.getByRole('button', { name: 'Cancel' }).click()
  await expect(dlg).not.toBeVisible()

  // ── Submit the request with a note ─────────────────────────────────────────
  await askAside.click()
  const ask = page.getByRole('dialog', { name: 'Request training — CVD Furnace' })
  await expect(ask).toBeVisible()
  await ask.getByLabel('Note (optional)').fill('Need hBN growth training before Thursday runs')
  await ask.getByRole('button', { name: 'Send request' }).click()
  await expect(page.getByText('Training request sent.')).toBeVisible()
  await expect(ask).not.toBeVisible()

  // A second open request is refused with the friendly duplicate message.
  await askAside.click()
  await expect(ask).toBeVisible()
  await ask.getByRole('button', { name: 'Send request' }).click()
  await expect(page.getByText('You already have an open training request for this instrument.')).toBeVisible()

  const row = await db.trainingRequest.findFirstOrThrow({ where: { equipmentId: eq.id } })
  expect(row.note).toBe('Need hBN growth training before Thursday runs')
  expect(row.status).toBe('PENDING')

  // W20-D: the admin's Certifications nav badge lights live from the request's
  // notif event — the admin page has sat on /people since the invite, untouched.
  const certBadge = adminPage.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /^Certifications/ }).locator('span.rounded-full')
  await expect(certBadge).toHaveText('1')

  // ── The admin decides under Certifications → Requests ──────────────────────
  await adminPage.goto('/certifications')
  await waitForHydration(adminPage)
  await main(adminPage).getByRole('tab', { name: 'Requests' }).click()
  // The tab rail is URL state: gate on the URL, not on the panel's content — the
  // matrix's own cells can match the same names mid-navigation (strict mode).
  await adminPage.waitForURL(/\/certifications\?tab=requests$/)
  const requests = main(adminPage).getByRole('tabpanel')
  await expect(requests.getByRole('cell', { name: 'Noor', exact: true })).toBeVisible()
  await expect(requests.getByRole('cell', { name: 'CVD Furnace', exact: true })).toBeVisible()
  await expect(requests.getByRole('cell', { name: 'Need hBN growth training before Thursday runs' })).toBeVisible()

  // Grant keeps the matrix flow's inputs: training date defaults to today.
  await requests.getByRole('button', { name: 'Grant' }).click()
  const grant = adminPage.getByRole('dialog', { name: 'Grant training — Noor on CVD Furnace' })
  await expect(grant).toBeVisible()
  const org = await db.organization.findFirstOrThrow()
  await expect(grant.getByLabel('Training date')).toHaveValue(
    new Intl.DateTimeFormat('en-CA', { timeZone: org.timezone }).format(new Date()))
  await grant.getByRole('button', { name: 'Grant' }).click()
  await expect(grant).not.toBeVisible()
  await expect(certBadge).toHaveCount(0) // decided → the badge clears (not the bell)
  // The decided row falls out of the queue.
  await expect(requests.getByRole('cell', { name: 'Noor', exact: true })).not.toBeVisible()

  // ── The member's matrix cell flips certified ───────────────────────────────
  await page.goto('/certifications')
  await waitForHydration(page)
  await expect(page.getByRole('checkbox', { name: 'Noor — CVD Furnace' })).toBeChecked()

  // Certified ⇒ the ask is gone from the equipment page.
  await page.goto(`/booking/${eq.id}`)
  await expect(main(page).getByRole('button', { name: 'Request training' })).toHaveCount(0)

  // ── The member's bell carries the decision ─────────────────────────────────
  await page.getByRole('button', { name: 'Notifications' }).click()
  await expect(page.getByText('Training granted: you are now certified on CVD Furnace.')).toBeVisible()
})

// W21-A: on a MANAGED instrument only its managers decide. A member who manages
// XPS sees the request, its badge and the Grant flow; the non-manager admin's
// queue is empty and carries no badge.
test('a managed instrument: its member-manager grants; the non-manager admin sees nothing', async ({ browser }) => {
  test.setTimeout(240_000)
  const adminPage = await newPage(browser)
  await runWizard(adminPage)
  const token = await createMemberViaInvite(adminPage, 'lina@lab.test', 'member')
  const lp = await newPage(browser)
  await acceptInvite(lp, token, 'Lina', 'MemberPass!1234')
  const lina = await db.user.findFirstOrThrow({ where: { email: 'lina@lab.test' } })
  const eq = await db.equipment.create({ data: { name: 'XPS', certificationRequired: true, approvalPolicy: 'NONE' } })
  await db.equipmentManager.create({ data: { userId: lina.id, equipmentId: eq.id } })
  const omar = await db.user.create({ data: { id: randomUUID(), name: 'Omar', email: 'omar@lab.test', emailVerified: true, role: 'member' } })
  await db.trainingRequest.create({ data: { userId: omar.id, equipmentId: eq.id, note: 'XPS depth profiling' } })

  // The non-manager admin: the tab stays (fallback queue), its contents are empty.
  // The badge is asserted only AFTER NavCountsSync's live fetch lands — before it,
  // the SSR seed alone paints and an absent badge would prove nothing about the
  // live count.
  const adminCounts = adminPage.waitForResponse((r) => r.url().includes('/api/nav-counts') && r.ok())
  await adminPage.goto('/certifications?tab=requests')
  await waitForHydration(adminPage)
  expect((await (await adminCounts).json()).trainingRequests).toBe(0)
  await expect(main(adminPage).getByText('No training requests')).toBeVisible()
  await expect(main(adminPage).getByRole('cell', { name: 'Omar', exact: true })).toHaveCount(0)
  await expect(adminPage.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /^Certifications/ }).locator('span.rounded-full')).toHaveCount(0)

  // The member-manager: badge 1, the row, and a working grant.
  await lp.goto('/certifications')
  await waitForHydration(lp)
  const badge = lp.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /^Certifications/ }).locator('span.rounded-full')
  await expect(badge).toHaveText('1')
  await main(lp).getByRole('tab', { name: 'Requests' }).click()
  await lp.waitForURL(/\/certifications\?tab=requests$/)
  const requests = main(lp).getByRole('tabpanel')
  await expect(requests.getByRole('cell', { name: 'Omar', exact: true })).toBeVisible()
  await requests.getByRole('button', { name: 'Grant' }).click()
  const grant = lp.getByRole('dialog', { name: 'Grant training — Omar on XPS' })
  await expect(grant).toBeVisible()
  await grant.getByRole('button', { name: 'Grant' }).click()
  await expect(grant).not.toBeVisible()
  await expect(badge).toHaveCount(0)
  await expect.poll(async () => (await db.certification.findUnique({ where: { userId_equipmentId: { userId: omar.id, equipmentId: eq.id } } }))?.grantedById).toBe(lina.id)
})

test('guests see no request affordance; members see one per certification-gated card', async ({ browser }) => {
  test.setTimeout(180_000)
  const adminPage = await newPage(browser)
  await runWizard(adminPage)
  const eq = await db.equipment.create({ data: { name: 'Raman', certificationRequired: true, approvalPolicy: 'NONE' } })
  await db.equipment.create({ data: { name: 'Sonic Bath', approvalPolicy: 'NONE' } })
  const guestToken = await createMemberViaInvite(adminPage, 'fyp@lab.test', 'guest')

  const guest = await newPage(browser)
  await acceptInvite(guest, guestToken, 'FYP Student', 'GuestPass!1234')

  // The catalogue files the instrument under "Needs certification" for everyone;
  // the card's ask is member/admin-only, so the guest sees the section but no button.
  await guest.goto('/booking')
  await expect(main(guest).getByRole('heading', { name: 'Needs certification' })).toBeVisible()
  await expect(main(guest).getByRole('button', { name: 'Request training' })).toHaveCount(0)

  // …and the equipment page's policy aside keeps it hidden too.
  await guest.goto(`/booking/${eq.id}`)
  await expect(main(guest).getByRole('button', { name: 'Request training' })).toHaveCount(0)

  // A member gets exactly one per gated card (and none on the open instrument).
  const memberToken = await createMemberViaInvite(adminPage, 'mia@lab.test', 'member')
  const member = await newPage(browser)
  await acceptInvite(member, memberToken, 'Mia', 'MemberPass!1234')
  await member.goto('/booking')
  const cards = main(member).locator('section', { has: member.getByRole('heading', { name: 'Needs certification' }) })
  await expect(cards.getByRole('button', { name: 'Request training' })).toHaveCount(1)
})
