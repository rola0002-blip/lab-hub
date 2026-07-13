import { test, expect, type Browser, type Page } from '@playwright/test'
import { wipe, seedSystem, runWizard, signIn, ADMIN, createMemberViaInvite, acceptInvite } from './helpers'

// Per-context client IP so better-auth's per-IP sign-in/up rate limit never trips
// (mirrors the sp5/a11y/messaging/redesign suites). Band 10.50.x is unused by the
// others; isolating this file's sign-ins keeps them OUT of the default-localhost
// bucket that journeys.spec + issues.spec share — otherwise this file's uploads +
// sign-ins would flood that bucket and 429 the next suite's first sign-in.
let ipSeq = 0
async function newPage(browser: Browser): Promise<Page> {
  ipSeq += 1
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `10.50.${ipSeq}.7` } })
  return ctx.newPage()
}

// Serial + one-time wipe/seed: test 1 provisions the org + admin AND uploads the file
// the later tests reuse (workers:1 → one shared database).
test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => { await wipe(); await seedSystem() })

const PDF = Buffer.from('%PDF-1.4\n%COLOSSUS e2e\n', 'utf8')

test('admin uploads a file on /files; it appears and posts to #lab-updates', async ({ browser }) => {
  const page = await newPage(browser)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/files')
  await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible()
  // The hidden multipart <input type=file> the Upload button drives.
  await page.locator('input[type=file]').setInputFiles({ name: 'graphene SOP.pdf', mimeType: 'application/pdf', buffer: PDF })
  await expect(page.getByRole('link', { name: 'graphene SOP.pdf' })).toBeVisible()
  // The bot announced it in #lab-updates (admin auto-joined at wizard sign-up, Task 4).
  await page.goto('/chat')
  await page.getByRole('link', { name: /lab-updates/ }).click()
  await expect(page.getByText(/graphene SOP\.pdf/)).toBeVisible()
})

test('the command palette finds an uploaded file', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/dashboard')
  // Open the palette via its search trigger (robust across OS keyboard mappings).
  await page.getByRole('button', { name: /Search/ }).first().click()
  await page.getByRole('combobox').fill('graphene')
  const option = page.getByRole('option', { name: /graphene SOP\.pdf/ })
  await expect(option).toBeVisible()
  // Selecting a document option jumps to the file in a NEW TAB (command-palette.tsx
  // select(): window.open(href, '_blank', 'noopener')). Observed (instrumented)
  // headless contract: the noopener popup opens detached (never commits a URL), the
  // navigation GETs /uploads/documents/<uuid>.pdf (200), and — headless-shell
  // Chromium having no PDF viewer — the inline pdf becomes a DOWNLOAD that Chromium
  // attributes to the OPENER page, arriving even before the context's 'page' event.
  // So pre-arm BOTH waiters alongside the click: the context 'page' event proves a
  // new tab opened; the opener's 'download' carries the URL the jump landed on.
  const [popup, download] = await Promise.all([
    page.context().waitForEvent('page'),
    page.waitForEvent('download'),
    option.click(),
  ])
  expect(popup).toBeTruthy() // the palette really opened a new tab
  expect(download.url()).toContain('/uploads/documents/')
  // Served round-trip: the same session GETs that URL through the real uploads
  // route — 200 + the pdf mime (pdf serves inline per the SP5 invariant).
  const served = await page.request.get(download.url())
  expect(served.ok()).toBeTruthy()
  expect(served.headers()['content-type']).toContain('application/pdf')
})

test('a guest sees the Files nav + table but no upload or row-menu affordances', async ({ browser }) => {
  const page = await newPage(browser)
  // Invite + accept a guest in a fresh (isolated-IP) context.
  await signIn(page, ADMIN.email, ADMIN.password)
  const token = await createMemberViaInvite(page, 'guest@lab.test', 'guest')
  ipSeq += 1
  const guestCtx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `10.50.${ipSeq}.7` } })
  const gp = await guestCtx.newPage()
  await acceptInvite(gp, token, 'Guesty', 'Str0ngPass!123')
  await gp.goto('/files')
  // `exact` disambiguates the sidebar nav "Files" from the folder rail's "All files".
  await expect(gp.getByRole('link', { name: 'Files', exact: true })).toBeVisible()  // nav visible to guests
  await expect(gp.getByRole('link', { name: 'graphene SOP.pdf' })).toBeVisible()     // can browse + download
  await expect(gp.getByRole('button', { name: 'Upload' })).toHaveCount(0)            // no upload affordance
  await expect(gp.getByRole('button', { name: /actions/ })).toHaveCount(0)           // no row/folder menu
  await expect(gp.getByRole('button', { name: 'New folder' })).toHaveCount(0)        // no folder creation
  await guestCtx.close()
})
