import { test, expect, type Browser, type Page } from '@playwright/test'
import ExcelJS from 'exceljs'
import { wipe, seedSystem, runWizard, signIn, waitForHydration, ADMIN, createMemberViaInvite, acceptInvite } from './helpers'

// W9-B — RA acknowledgments: the /ra round trip. Test order is load-bearing:
// the four journeys are ORDER-DEPENDENT (serial mode, one shared database),
// so running any single one with --grep fails by design. Journey 1 must run
// BEFORE any 'RA' folder exists (it asserts the friendly empty state);
// journey 2 creates the folder + uploads two risk assessments through the
// real Files UI, then bulk-acknowledges both in one submit (wave 19); journey
// 3 reads the admin records table + the Excel export; journey 4 revokes on both sides —
// the member's own revoke frees re-acknowledgement, and the re-ack it creates
// is the row the admin then revokes from Records. The member's matric
// 'NTU2026ABS' is the thread the journeys share — consumed and re-created by
// journey 4 itself.
//
// RA_DOC 'risk assessment.pdf' is a SUBSTRING of RA_DOC2 'laser cutters risk
// assessment.pdf' — substring locators (hasText, role-name) hit both. The
// disambiguation idioms used throughout: exact:true role names (checkbox
// accessible name is the doc name, later '… — acknowledged'), hasNotText on
// row/listitem filters, and EXACT cell equality on the parsed workbook.
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
// Wave 19 bulk acknowledge: a second doc whose name CONTAINS RA_DOC — the
// substring pitfall this file deliberately exercises.
const RA_DOC2 = 'laser cutters risk assessment.pdf'

// Parsed RA column (D) of the admin export — EXACT cell values, so RA_DOC can
// never substring-match RA_DOC2. APIResponse has .body(), not .arrayBuffer().
async function exportedRaColumn(page: Page): Promise<string[]> {
  const res = await page.request.get('/api/ra/acknowledgments/export')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('spreadsheetml')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load((await res.body()) as unknown as Parameters<ExcelJS.Workbook['xlsx']['load']>[0])
  const ws = wb.getWorksheet('RA acknowledgments')!
  const out: string[] = []
  ws.eachRow((row, n) => { if (n > 1) out.push(String(row.getCell(4).value)) })
  return out
}

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
  await expect(page.getByRole('button', { name: 'I have read the selected RAs' })).toHaveCount(0)

  // Member: same absence, and never a Records section — the page fetches admin
  // data only for admins (the role-adaptive /feedback pattern).
  await mp.goto('/ra')
  await expect(mp.getByText('No RA folder yet')).toBeVisible()
  await expect(mp.getByRole('heading', { name: 'Records' })).toHaveCount(0)

  await mp.context().close()
  await page.context().close()
})

// ─────────────────────────────────────────────────────────────────────────────
test('2: member bulk-acknowledges both RAs and sees their history', async ({ browser }) => {
  test.setTimeout(150_000)

  // The admin creates the folder named exactly 'RA' and uploads both risk
  // assessments into it (the files.spec.ts folder-create + upload idioms; the
  // upload input is multiple — one setInputFiles call carries both buffers).
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
  await ap.locator('input[type=file]').setInputFiles([
    { name: RA_DOC, mimeType: 'application/pdf', buffer: PDF },
    { name: RA_DOC2, mimeType: 'application/pdf', buffer: PDF },
  ])
  await expect(ap.getByRole('link', { name: RA_DOC, exact: true })).toBeVisible()
  await expect(ap.getByRole('link', { name: RA_DOC2, exact: true })).toBeVisible()
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

  // Bulk acknowledge: tick BOTH checkboxes in one submit. The checkbox
  // accessible name is the label-wrapped doc name, and RA_DOC is a substring
  // of RA_DOC2 — exact:true pins each name (a substring name would match both
  // and trip strict mode).
  await mp.getByRole('checkbox', { name: RA_DOC, exact: true }).check()
  await mp.getByRole('checkbox', { name: RA_DOC2, exact: true }).check()
  await mp.getByLabel('Matriculation number').fill(MATRIC)
  await mp.getByRole('button', { name: 'I have read the selected RAs' }).click()

  // The toast is the immediate signal (bulk shape: count + plural); the rows
  // (via router.refresh) are the durable one. Both listitem rows carry the
  // matric — the short row isolated with hasNotText (substring pitfall).
  // Task 12 toast shape: toasts carry no role — the text is pinned inside the
  // host container's single polite live region (the sr-only shell regions are empty).
  await expect(mp.locator('[aria-live="polite"]').getByText('Acknowledged 2 RAs — recorded.')).toBeVisible()
  const rows = mp.getByRole('listitem').filter({ hasText: MATRIC })
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: RA_DOC2 })).toContainText(RA_DOC2)
  await expect(rows.filter({ hasNotText: RA_DOC2 })).toContainText(RA_DOC)

  // A member never receives records data at all.
  await expect(mp.getByRole('heading', { name: 'Records' })).toHaveCount(0)

  // Re-visit: BOTH checkboxes come back checked and disabled — real inputs,
  // so toBeDisabled() works (the old <option>-attribute workaround is gone).
  // Accessible names now carry the ' — acknowledged' suffix, so the exact
  // match includes it.
  await mp.goto('/ra')
  await waitForHydration(mp)
  for (const name of [RA_DOC, RA_DOC2]) {
    const box = mp.getByRole('checkbox', { name: `${name} — acknowledged`, exact: true })
    await expect(box).toBeChecked()
    await expect(box).toBeDisabled()
  }

  await mp.context().close()
})

// ─────────────────────────────────────────────────────────────────────────────
test('3: admin sees records + Excel export', async ({ browser }) => {
  test.setTimeout(150_000)
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/ra')
  await expect(page.getByRole('heading', { name: 'Records' })).toBeVisible()

  // The records table carries BOTH of the member's rows (bulk submit) —
  // each isolated from the substring pitfall via RA_DOC2 text presence.
  const rows = page.getByRole('row').filter({ hasText: MATRIC })
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: RA_DOC2 })).toContainText(MEMBER.name)
  await expect(rows.filter({ hasNotText: RA_DOC2 })).toContainText(MEMBER.name)
  const exportLink = page.getByRole('link', { name: 'Export Excel' })
  await expect(exportLink).toBeVisible()
  await expect(exportLink).toHaveAttribute('download', '')
  expect((await exportedRaColumn(page)).sort()).toEqual([RA_DOC, RA_DOC2].sort())

  await page.context().close()
})

// ─────────────────────────────────────────────────────────────────────────────
test('4: revoke — own row frees re-acknowledgement; admin revoke removes the record', async ({ browser }) => {
  test.setTimeout(150_000)

  // Member revokes just the short-RA acknowledgment (journey 2's first row) —
  // the styled ConfirmDialog (v0.32), scoped by its own accessible name. The
  // listitem is isolated with hasNotText: RA_DOC is a substring of RA_DOC2's
  // row, and that row must SURVIVE this revoke.
  const mp = await newPage(browser)
  await signIn(mp, MEMBER.email, MEMBER.pass)
  await mp.goto('/ra')
  await waitForHydration(mp)
  await mp.getByRole('listitem').filter({ hasText: RA_DOC }).filter({ hasNotText: RA_DOC2 }).getByRole('button', { name: 'Revoke' }).click()
  const ownConfirm = mp.getByRole('dialog', { name: `Revoke your acknowledgment of “${RA_DOC}”?` })
  await expect(ownConfirm).toBeVisible()
  await ownConfirm.getByRole('button', { name: 'Revoke' }).click()
  await expect(mp.locator('[aria-live="polite"]').getByText('Acknowledgment revoked.')).toBeVisible()
  await expect(mp.getByRole('listitem').filter({ hasText: RA_DOC }).filter({ hasNotText: RA_DOC2 })).toHaveCount(0)
  // The long-RA acknowledgment survives — no 'not acknowledged any RA yet'
  // line here anymore (mine.length is still 1).
  await expect(mp.getByRole('listitem').filter({ hasText: RA_DOC2 })).toContainText(MATRIC)

  // Re-acknowledgement is possible again: the short RA's checkbox is enabled
  // (exact name — no ' — acknowledged' suffix once revoked; RA_DOC2's box
  // stays checked+disabled) and the singular bulk toast shape is '1 RA'.
  await mp.getByRole('checkbox', { name: RA_DOC, exact: true }).check()
  await mp.getByLabel('Matriculation number').fill(MATRIC)
  await mp.getByRole('button', { name: 'I have read the selected RAs' }).click()
  await expect(mp.locator('[aria-live="polite"]').getByText('Acknowledged 1 RA — recorded.')).toBeVisible()
  await mp.context().close()

  // Admin revokes the member's re-acked short-RA row from Records (the
  // long-RA row shares MATRIC — isolated with hasNotText); the export stops
  // carrying that record while keeping the survivor (exact cell equality —
  // RA_DOC is a substring of RA_DOC2).
  const ap = await newPage(browser)
  await signIn(ap, ADMIN.email, ADMIN.password)
  await ap.goto('/ra')
  await expect(ap.getByRole('heading', { name: 'Records' })).toBeVisible()
  await ap.getByRole('row').filter({ hasText: RA_DOC }).filter({ hasNotText: RA_DOC2 }).getByRole('button', { name: 'Revoke' }).click()
  const adminConfirm = ap.getByRole('dialog', { name: `Revoke ${MEMBER.name}'s acknowledgment of “${RA_DOC}”?` })
  await expect(adminConfirm).toBeVisible()
  await adminConfirm.getByRole('button', { name: 'Revoke' }).click()
  await expect(ap.locator('[aria-live="polite"]').getByText('Acknowledgment revoked.')).toBeVisible()
  await expect(ap.getByRole('row').filter({ hasText: RA_DOC }).filter({ hasNotText: RA_DOC2 })).toHaveCount(0)
  await expect(ap.getByRole('row').filter({ hasText: RA_DOC2 })).toContainText(MATRIC)
  expect(await exportedRaColumn(ap)).toEqual([RA_DOC2])
  await ap.context().close()
})
