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

// v0.15 §5.3 — the project↔folder tests below share the project the linking test
// creates (serial file, one database).
const PROJECT = 'Graphene growth'
let projectId = ''

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

test('a file row action menu opens unclipped and its items are clickable', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/files')
  await page.getByRole('button', { name: 'File graphene SOP.pdf actions' }).click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  // Regression (v0.10.0): the listing <ul> carried `overflow-hidden`, so menu.tsx's
  // clip-bound pass measured that <ul> as the popover's clipping ancestor. On a short
  // list the <ul> is barely taller than the trigger, so both spaceAbove and spaceBelow
  // collapsed and the popover was capped to `max-height: 1px`. The items were scrolled
  // out of sight inside that 1px overflow-y-auto box, yet kept layout rects below it —
  // so a click at an item's own coordinates fell through to the page behind.
  // Assert the popover renders at its natural height…
  await expect.poll(() => menu.evaluate((el) => el.getBoundingClientRect().height + 1 < el.scrollHeight)).toBe(false)
  // …and that a real click lands on the item. Clicking the item's measured coordinates
  // is the stronger idiom here: locator.click() first scroll-into-views every scrollable
  // ancestor — and an overflow:hidden box is still scriptably scrollable even though a
  // user can never scroll it — so it does not reproduce what the user's pointer does.
  const box = (await page.getByRole('menuitem', { name: 'Rename' }).boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByRole('heading', { name: 'Rename file' })).toBeVisible()
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

// W4-C: rename/move is uploader-or-admin. A member's own upload keeps the
// affordances; the admin's upload (seeded by test 1) loses Rename/Move… while
// keeping the row menu itself (Download) — mayUpload renders the menu, the
// canModifyDocument predicate gates the items.
test('a member can rename/move their own upload but has no Rename/Move on the admin\'s file (W4-C)', async ({ browser }) => {
  const ap = await newPage(browser)
  await signIn(ap, ADMIN.email, ADMIN.password)
  const token = await createMemberViaInvite(ap, 'member@lab.test', 'member')
  ipSeq += 1
  const memberCtx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `10.50.${ipSeq}.7` } })
  const mp = await memberCtx.newPage()
  await acceptInvite(mp, token, 'Membra', 'Str0ngPass!123')
  await mp.goto('/files')
  // Own upload → Rename + Move… are offered.
  await mp.locator('input[type=file]').setInputFiles({ name: 'member notes.pdf', mimeType: 'application/pdf', buffer: PDF })
  await expect(mp.getByRole('link', { name: 'member notes.pdf' })).toBeVisible()
  await mp.getByRole('button', { name: 'File member notes.pdf actions' }).click()
  await expect(mp.getByRole('menuitem', { name: 'Rename' })).toBeVisible()
  await expect(mp.getByRole('menuitem', { name: 'Move…' })).toBeVisible()
  await mp.keyboard.press('Escape')
  // Admin's upload → the row menu still opens, but Rename/Move… are absent.
  await mp.getByRole('button', { name: 'File graphene SOP.pdf actions' }).click()
  await expect(mp.getByRole('menuitem', { name: 'Rename' })).toHaveCount(0)
  await expect(mp.getByRole('menuitem', { name: 'Move…' })).toHaveCount(0)
  await expect(mp.getByRole('menuitem', { name: 'Download' })).toBeVisible()
  await memberCtx.close()
})

// ── v0.15 §5.3 — project ↔ Files folder ──────────────────────────────────────
test('a project links a Files folder and shows that folder on its page', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)

  // A folder with one file of its own. The root file uploaded by test 1 stays where
  // it is — it is the control that proves the card lists the FOLDER, not every file.
  await page.goto('/files')
  await page.getByRole('button', { name: 'New folder' }).click()
  await page.getByLabel('Name').fill('Protocols')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('link', { name: 'Protocols' }).click()
  await expect(page).toHaveURL(/\/files\?folder=/)
  await page.locator('input[type=file]').setInputFiles({ name: 'CVD recipe.pdf', mimeType: 'application/pdf', buffer: PDF })
  await expect(page.getByRole('link', { name: 'CVD recipe.pdf' })).toBeVisible()

  await page.goto('/projects')
  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByLabel('Name').fill(PROJECT)
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/projects\/[^/]+$/)
  projectId = new URL(page.url()).pathname.split('/').pop()!
  // No folder linked yet ⇒ no card at all (the select is the affordance, §5.3).
  await expect(page.getByRole('heading', { name: /^Files in / })).toHaveCount(0)

  await page.getByRole('button', { name: 'Project actions' }).click()
  await page.getByRole('menuitem', { name: 'Edit project' }).click()
  await expect(page.getByRole('dialog', { name: 'Edit project' })).toBeVisible()
  // A label-wrapped <select> is located by role — getByLabel would match option text.
  await page.getByRole('combobox', { name: 'Files folder' }).selectOption({ label: 'Protocols' })
  await page.getByRole('button', { name: 'Save project' }).click()

  // Repainted in place — no reload between the Save and these assertions.
  await expect(page.getByRole('heading', { name: 'Files in Protocols' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'CVD recipe.pdf' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'graphene SOP.pdf' })).toHaveCount(0) // root file, other folder

  await page.getByRole('link', { name: 'Open in Files' }).click()
  await expect(page).toHaveURL(/\/files\?folder=/)
  await expect(page.getByRole('link', { name: 'Protocols' })).toHaveAttribute('aria-current', 'page') // scoped, not "All files"
  await expect(page.getByRole('link', { name: 'CVD recipe.pdf' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'graphene SOP.pdf' })).toHaveCount(0)
})

test('a guest sees the linked-folder card read-only, with no way to change the link', async ({ browser }) => {
  const gp = await newPage(browser)
  await signIn(gp, 'guest@lab.test', 'Str0ngPass!123') // invited + accepted by the guest test above
  await gp.goto(`/projects/${projectId}`)
  await expect(gp.getByRole('heading', { name: PROJECT })).toBeVisible()
  // Browse + download are open to guests by documents-policy, so the card is identical…
  await expect(gp.getByRole('heading', { name: 'Files in Protocols' })).toBeVisible()
  await expect(gp.getByRole('link', { name: 'CVD recipe.pdf' })).toBeVisible()
  await expect(gp.getByRole('link', { name: 'Open in Files' })).toBeVisible()
  // …but nothing on this page can re-link it: the guest kebab exists (F3 pin
  // access), and the safety is item-gating — "Edit project" stays canEdit-gated —
  // so the composer, and its "Files folder" select, remains unreachable for guests.
  await expect(gp.getByRole('button', { name: 'Project actions' })).toBeVisible()
  await gp.getByRole('button', { name: 'Project actions' }).click()
  await expect(gp.getByRole('menuitem', { name: 'Edit project' })).toHaveCount(0)
  await expect(gp.getByRole('menuitem', { name: 'Pin to My issues' })).toBeVisible()
  await expect(gp.getByRole('combobox', { name: 'Files folder' })).toHaveCount(0)
})

test('"No folder" unlinks the folder (it submits null, never an empty string)', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto(`/projects/${projectId}`)
  await page.getByRole('button', { name: 'Project actions' }).click()
  await page.getByRole('menuitem', { name: 'Edit project' }).click()
  await page.getByRole('combobox', { name: 'Files folder' }).selectOption({ label: 'No folder' })
  await page.getByRole('button', { name: 'Save project' }).click()
  // An empty-string id would reach assertFolderExists and be REFUSED — the dialog
  // would stay open under a "That folder no longer exists." toast, and the card
  // would survive. Both halves are asserted: the write went through…
  await expect(page.getByRole('dialog', { name: 'Edit project' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Files in Protocols' })).toHaveCount(0)
  // …and it was the LINK that was cleared, not just the paint (the folder itself is
  // untouched — it and its file are still on /files).
  await page.reload()
  await expect(page.getByRole('heading', { name: /^Files in / })).toHaveCount(0)
  await page.goto('/files')
  await expect(page.getByRole('link', { name: 'Protocols' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'CVD recipe.pdf' })).toBeVisible()
})
