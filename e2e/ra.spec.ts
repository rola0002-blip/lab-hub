import { test, expect, type Browser, type Page } from '@playwright/test'
import { wipe, seedSystem, runWizard, signIn, waitForHydration, ADMIN, createMemberViaInvite, acceptInvite } from './helpers'

// W9-B — RA acknowledgments: the /ra round trip. Test order is load-bearing —
// journey 1 must run BEFORE any 'RA' folder exists (it asserts the friendly
// empty state); journey 2 creates the folder + uploads the risk assessment
// through the real Files UI; journey 3 reads the admin records table + CSV.
// The member's matric 'NTU2026ABS' is the thread the three journeys share.
//
// Per-context client IP so better-auth's per-IP sign-in/up limit never trips.
// Bands 10.10–10.91 are taken by the other suites (see feedback.spec.ts's
// header comment), so this file claims 10.92.x and stays out of every bucket.
let ipSeq = 0
async function newPage(browser: Browser): Promise<Page> {
  ipSeq += 1
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `10.92.${ipSeq}.7` } })
  return ctx.newPage()
}

// Serial + ONE-TIME wipe/seed: journey 1 provisions the org, the admin and the
// member (workers:1 → one shared database); the later journeys only sign in.
test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => { await wipe(); await seedSystem() })

// Single-word display name (the Avatar monogram determinism note, feedback.spec.ts).
const MEMBER = { email: 'member@lab.test', name: 'Mira', pass: 'MemberPass!1234' }
const MATRIC = 'NTU2026ABS'

// A real PDF payload — the uploads route serves the stored bytes back, and the
// Files row must survive the Documents listing (the files.spec.ts idiom).
const PDF = Buffer.from('%PDF-1.4\n%RA e2e\n', 'utf8')
const RA_DOC = 'risk assessment.pdf'

// ─────────────────────────────────────────────────────────────────────────────
test('1: no RA folder yet shows the friendly empty state', async ({ browser }) => {
  test.setTimeout(150_000)
  const page = await newPage(browser)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)

  // The member is provisioned here (serial file, one shared database): journeys
  // 2–3 reuse the account, and this journey also needs a non-admin's /ra view.
  const token = await createMemberViaInvite(page, MEMBER.email, 'member')
  const mp = await newPage(browser)
  await acceptInvite(mp, token, MEMBER.name, MEMBER.pass)

  // Admin: no folder ⇒ the friendly empty state and NO form at all.
  await page.goto('/ra')
  await expect(page.getByRole('heading', { name: 'RA acknowledgments' })).toBeVisible()
  await expect(page.getByText('No RA folder yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'I have read this RA' })).toHaveCount(0)

  // Member: same absence, and never a Records section — the page fetches admin
  // data only for admins (the role-adaptive /feedback pattern).
  await mp.goto('/ra')
  await expect(mp.getByText('No RA folder yet')).toBeVisible()
  await expect(mp.getByRole('heading', { name: 'Records' })).toHaveCount(0)

  await mp.context().close()
  await page.context().close()
})

// ─────────────────────────────────────────────────────────────────────────────
test('2: member acknowledges an RA and sees their history', async ({ browser }) => {
  test.setTimeout(150_000)

  // The admin creates the folder named exactly 'RA' and uploads the risk
  // assessment into it (the files.spec.ts folder-create + upload idioms).
  const ap = await newPage(browser)
  await signIn(ap, ADMIN.email, ADMIN.password)
  await ap.goto('/files')
  await waitForHydration(ap)
  await ap.getByRole('button', { name: 'New folder' }).click()
  await ap.getByLabel('Name').fill('RA')
  await ap.getByRole('button', { name: 'Save' }).click()
  // Scoped to <main>: the sidebar (wave 9) also carries an 'RA' nav row now.
  await ap.locator('main').getByRole('link', { name: 'RA', exact: true }).click()
  await expect(ap).toHaveURL(/\/files\?folder=/)
  await ap.locator('input[type=file]').setInputFiles({ name: RA_DOC, mimeType: 'application/pdf', buffer: PDF })
  await expect(ap.getByRole('link', { name: RA_DOC })).toBeVisible()
  await ap.context().close()

  const mp = await newPage(browser)
  await signIn(mp, MEMBER.email, MEMBER.pass)
  await mp.goto('/ra')
  await waitForHydration(mp)
  await expect(mp.getByRole('heading', { name: 'My acknowledgments' })).toBeVisible()

  // Own name, locked: the record is bound to the signed-in account, so the field
  // is read-only and carries the member's name.
  const nameField = mp.getByLabel('Full name')
  await expect(nameField).toHaveValue(MEMBER.name)
  await expect(nameField).toHaveAttribute('readonly')

  // A label-wrapped <select> is located by role — getByLabel would match option text.
  await mp.getByRole('combobox', { name: 'Which RA did you read?' }).selectOption({ label: RA_DOC })
  await mp.getByLabel('Matriculation number').fill(MATRIC)
  await mp.getByRole('button', { name: 'I have read this RA' }).click()

  // The toast is the immediate signal; the row (via router.refresh) is the durable one.
  await expect(mp.getByRole('status').filter({ hasText: 'Acknowledged — recorded.' })).toBeVisible()
  const row = mp.getByRole('listitem').filter({ hasText: RA_DOC })
  await expect(row).toContainText(MATRIC)

  // A member never receives records data at all.
  await expect(mp.getByRole('heading', { name: 'Records' })).toHaveCount(0)

  // Re-visit: the acknowledged document's option is disabled and labelled so.
  // (Attribute assertion, not toBeDisabled(): Playwright's disabled check does
  // not honour the disabled state of an <option>, even when present in the DOM.)
  await mp.goto('/ra')
  await waitForHydration(mp)
  const option = mp.getByRole('combobox', { name: 'Which RA did you read?' }).locator('option', { hasText: RA_DOC })
  await expect(option).toHaveAttribute('disabled')
  await expect(option).toHaveText(/— acknowledged/)

  await mp.context().close()
})

// ─────────────────────────────────────────────────────────────────────────────
test('3: admin sees records + CSV export', async ({ browser }) => {
  test.setTimeout(150_000)
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/ra')
  await expect(page.getByRole('heading', { name: 'Records' })).toBeVisible()

  // The records table carries the member's row: name + matric side by side.
  const row = page.getByRole('row').filter({ hasText: MATRIC })
  await expect(row).toContainText(MEMBER.name)
  await expect(page.getByRole('link', { name: 'Export CSV' })).toBeVisible()

  // page.request shares the page's storage state — this GET is the admin session.
  const csv = await page.request.get('/api/ra/acknowledgments/csv')
  expect(csv.status()).toBe(200)
  expect(csv.headers()['content-type']).toContain('text/csv')
  const body = await csv.text()
  expect(body).toContain(MATRIC)
  // cell() quotes every field, so the header line is the quoted form.
  expect(body).toContain('"name","email","matric","ra","acknowledgedAt"')

  await page.context().close()
})
