import { test, expect, type Browser, type Page } from '@playwright/test'
import { wipe, seedSystem, runWizard, signIn, waitForHydration, ADMIN, createMemberViaInvite, acceptInvite, db } from './helpers'

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
  // `exact` (wave 18): substring matching also hits the listing header's
  // "Sort by uploader, ascending" button — the real Upload button's name is exactly "Upload".
  await expect(gp.getByRole('button', { name: 'Upload', exact: true })).toHaveCount(0) // no upload affordance
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

// ── v0.32 — file versioning ──────────────────────────────────────────────────
test('uploading a new version shows a v2 chip; history lists both; restore makes v3', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/files')
  await waitForHydration(page)
  const DOC = 'furnace log.pdf'
  const PDF2 = Buffer.from('%PDF-1.4\n%COLOSSUS e2e v2\n', 'utf8')
  // v1: the plain upload flow (exactly one file input exists while no version
  // pick is pending — the version input mounts only after its menu item).
  await page.locator('input[type=file]').first().setInputFiles({ name: DOC, mimeType: 'application/pdf', buffer: PDF })
  const row = page.locator('li').filter({ has: page.getByRole('link', { name: DOC }) })
  await expect(page.getByRole('link', { name: DOC })).toBeVisible()
  await expect(row.getByText('v1', { exact: true })).toHaveCount(0) // no chip at v1

  // v2: "Upload new version…" mounts the hidden per-pick input, then POSTs.
  await page.getByRole('button', { name: `File ${DOC} actions` }).click()
  await page.getByRole('menuitem', { name: 'Upload new version…' }).click()
  await page.getByLabel(`Version file for ${DOC}`).setInputFiles({ name: DOC, mimeType: 'application/pdf', buffer: PDF2 })
  await expect(row.getByText('v2', { exact: true })).toBeVisible()

  // History drawer: both versions, newest first, with per-version Download.
  await page.getByRole('button', { name: `File ${DOC} actions` }).click()
  await page.getByRole('menuitem', { name: 'History' }).click()
  const drawer = page.getByRole('dialog', { name: 'Version history' })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByText('v2', { exact: true })).toBeVisible()
  await expect(drawer.getByText('v1', { exact: true })).toBeVisible()
  await expect(drawer.getByRole('link', { name: 'Download' })).toHaveCount(2)

  // Restore v1 → linear history appends v3 (now current); v1 stays restorable.
  // NB: filter({ has }) matches the inner locator starting from the OUTER li —
  // pre-scoping it to the drawer matches nothing (verified empirically).
  const v1Row = drawer.locator('li').filter({ has: page.getByText('v1', { exact: true }) })
  await v1Row.getByRole('button', { name: 'Restore' }).click()
  await expect(drawer.getByText('v3', { exact: true })).toBeVisible()
  await expect(drawer.getByRole('link', { name: 'Download' })).toHaveCount(3)
  await drawer.getByRole('button', { name: 'Close version history' }).click()
  await expect(drawer).toHaveCount(0)
  await expect(row.getByText('v3', { exact: true })).toBeVisible() // row chip caught up

  // Delete confirm names the version count.
  await page.getByRole('button', { name: `File ${DOC} actions` }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete file?' })
  await expect(confirm).toContainText(`Delete ${DOC} and its 3 versions?`)
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByRole('link', { name: DOC })).toHaveCount(0)
})

// ── v0.15 §5.3 — project ↔ Files folder ──────────────────────────────────────
test('a project links a Files folder and shows that folder on its page', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)

  // A folder with one file of its own. The root file uploaded by test 1 stays where
  // it is — it is the control that proves the card lists the FOLDER, not every file.
  await page.goto('/files')
  await page.getByRole('button', { name: 'New folder' }).click()
  // `exact` (wave 18): substring matching also hits the listing header's
  // "Sort by name, ascending" button — the modal's label is exactly "Name".
  await page.getByLabel('Name', { exact: true }).fill('Protocols')
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
  await expect(gp.getByRole('menuitem', { name: 'Pin to sidebar' })).toBeVisible()
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

// ── wave 18 — sortable columns + tick-to-export zip ──────────────────────────
test('columns sort the listing; folder sort groups folders together', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)

  // Seed folders + docs straight into the DB (sorting never reads bytes), with
  // staggered createdAt so the default service order (createdAt desc) and the
  // in-folder orders are both deterministic. The timestamps sit a month in the
  // past, safely UNDER every real upload above, which keeps their relative
  // order fixed without touching them.
  const admin = await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })
  const chemical = await db.documentFolder.create({ data: { name: 'chemical list', createdById: admin.id } })
  const alpha = await db.documentFolder.create({ data: { name: 'alpha protocols', createdById: admin.id } })
  const t0 = Date.now() - 30 * 24 * 60 * 60 * 1000
  const seed = (name: string, folderId: string | null, minutes: number) =>
    db.document.create({ data: { name, folderId, path: `/uploads/documents/e2e-sort-${minutes}.pdf`, mime: 'application/pdf', size: 1024, uploaderId: admin.id, createdAt: new Date(t0 + minutes * 60 * 1000) } })
  await seed('chem hydrozene.pdf', chemical.id, 0)
  await seed('chem piranha.pdf', chemical.id, 600)
  await seed('alpha sputter.pdf', alpha.id, 1200)
  await seed('sort root.pdf', null, 1800)

  await page.goto('/files')
  await waitForHydration(page)
  // Row names in listed order: the listing's ONE <a> per row is the doc link.
  // Rooted at <main> (the mobile.spec rule: CSS locators must skip the hidden
  // SSR duplicate of the streamed tree that role locators ignore for free).
  const order = () => page.getByRole('main').locator('section ul li a').allTextContents()
  // Service order = createdAt desc across the whole serial chain so far:
  // CVD recipe.pdf (test 7) > member notes.pdf (test 5) > graphene SOP.pdf
  // (test 1) > the four seeded rows, newest first.
  const SERVICE = ['CVD recipe.pdf', 'member notes.pdf', 'graphene SOP.pdf', 'sort root.pdf', 'alpha sputter.pdf', 'chem piranha.pdf', 'chem hydrozene.pdf']
  await expect.poll(order).toEqual(SERVICE)

  // 1st click: asc. Root (no folder) clusters FIRST, and the sort is stable
  // within a cluster (service order survives as the tiebreak).
  const folderSort = page.getByRole('button', { name: 'Sort by folder' })
  await folderSort.click()
  await expect(folderSort).toHaveAccessibleName(/ascending \(active\)/)
  await expect.poll(order).toEqual([
    'member notes.pdf', 'graphene SOP.pdf', 'sort root.pdf', // root cluster
    'alpha sputter.pdf',                                      // 'alpha protocols'
    'chem piranha.pdf', 'chem hydrozene.pdf',                 // 'chemical list'
    'CVD recipe.pdf',                                         // 'Protocols'
  ])
  // 2nd click: desc — the CLUSTERS mirror, but a negated comparator still
  // returns 0 for equal folder keys, and Array.sort is stable: rows inside a
  // cluster keep the service order (createdAt desc) in both directions.
  await folderSort.click()
  await expect(folderSort).toHaveAccessibleName(/descending \(active\)/)
  await expect.poll(order).toEqual([
    'CVD recipe.pdf',
    'chem piranha.pdf', 'chem hydrozene.pdf',
    'alpha sputter.pdf',
    'member notes.pdf', 'graphene SOP.pdf', 'sort root.pdf',
  ])
  // 3rd click: tri-state back to the service order.
  await folderSort.click()
  await expect(folderSort).toHaveAccessibleName(/^Sort by folder, ascending$/)
  await expect.poll(order).toEqual(SERVICE)

  await db.document.deleteMany({ where: { name: { in: ['chem hydrozene.pdf', 'chem piranha.pdf', 'alpha sputter.pdf', 'sort root.pdf'] } } })
  await db.documentFolder.deleteMany({ where: { name: { in: ['chemical list', 'alpha protocols'] } } })
})

test('tick two files and export them as a zip download', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/files')
  await waitForHydration(page)
  // Both uploads at root in one multi-file pick (the hidden input is `multiple`).
  await page.locator('input[type=file]').first().setInputFiles([
    { name: 'export-a.pdf', mimeType: 'application/pdf', buffer: PDF },
    { name: 'export-b.pdf', mimeType: 'application/pdf', buffer: PDF },
  ])
  await expect(page.getByRole('link', { name: 'export-a.pdf' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'export-b.pdf' })).toBeVisible()

  // Root files → checkbox labels carry no folder suffix.
  await page.getByRole('checkbox', { name: 'Select export-a.pdf' }).check()
  await page.getByRole('checkbox', { name: 'Select export-b.pdf' }).check()
  const exportTwo = page.getByRole('button', { name: 'Export (2)' })
  await expect(exportTwo).toBeEnabled()

  // The button navigates an anchor with `download`, so the zip arrives as a
  // real download; the same session then GETs the URL and checks the zip
  // magic bytes (PK\x03\x04 — the writer is STORED-entry, byte-testable).
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportTwo.click(),
  ])
  expect(download.url()).toContain('/api/documents/export')
  const res = await page.request.get(download.url())
  expect(res.ok()).toBeTruthy()
  expect(res.headers()['content-type']).toBe('application/zip')
  // APIResponse.body() → Buffer (no arrayBuffer(); this is not fetch).
  expect((await res.body()).subarray(0, 4).toString('latin1')).toBe('PK\x03\x04')

  // Unticking walks the label back down: (2) → (1) → the bare, disabled Export.
  await page.getByRole('checkbox', { name: 'Select export-b.pdf' }).uncheck()
  await expect(page.getByRole('button', { name: 'Export (1)' })).toBeEnabled()
  await page.getByRole('checkbox', { name: 'Select export-a.pdf' }).uncheck()
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()

  await db.document.deleteMany({ where: { name: { in: ['export-a.pdf', 'export-b.pdf'] } } })
})

test('a guest can tick and export (read-any posture)', async ({ browser }) => {
  const gp = await newPage(browser)
  await signIn(gp, 'guest@lab.test', 'Str0ngPass!123') // invited + accepted by the guest test above
  await gp.goto('/files')
  await waitForHydration(gp)
  // graphene SOP.pdf (test 1's real upload — bytes on disk) is the export
  // source: the zip builder SKIPS rows whose stored file is gone and 404s an
  // empty set, so a db-seeded row without bytes would not download at all.
  const tick = gp.getByRole('checkbox', { name: 'Select graphene SOP.pdf' })
  await expect(tick).toBeVisible()
  // Idle at zero ticks: visible to guests, but disabled (not hidden).
  await expect(gp.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
  await tick.check()
  const exportOne = gp.getByRole('button', { name: 'Export (1)' })
  await expect(exportOne).toBeEnabled()
  const [download] = await Promise.all([
    gp.waitForEvent('download'),
    exportOne.click(),
  ])
  expect(download.url()).toContain('/api/documents/export')
  const res = await gp.request.get(download.url())
  expect(res.ok()).toBeTruthy()
  expect(res.headers()['content-type']).toBe('application/zip')
  expect((await res.body()).subarray(0, 4).toString('latin1')).toBe('PK\x03\x04')
})

// ── wave 19 — Name column drag-resize + persisted width ──────────────────────
test('name column drag-resizes, persists across reloads, and resets', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/files')
  await waitForHydration(page)
  // 90+ chars: long enough that a ~500px column still truncates it, so the
  // "fully scrolled right shows the whole name" assertion below is meaningful.
  const LONG = 'hbn growth run 0012 four-inch wafer transfer notes recipe log and post-run SEM recheck notes.pdf'
  await page.locator('input[type=file]').first().setInputFiles({ name: LONG, mimeType: 'application/pdf', buffer: PDF })
  const anchor = page.getByRole('link', { name: LONG })
  await expect(anchor).toBeVisible()

  // 1. The truncated anchor carries its full name as a title tooltip
  //    (the version-history-drawer idiom).
  await expect(anchor).toHaveAttribute('title', LONG)

  // 2. The resize affordance renders on this fine-pointer viewport.
  const handle = page.getByRole('button', { name: /Resize name column/ })
  await expect(handle).toBeVisible()

  // 3. Drag to a measured target. The gesture is delta-anchored (width-at-grab
  //    + pointer travel), so the commit = pointer x − column left − 15 (the
  //    gap-3 + half-handle offset): a pointer at (left + 640) commits ~625px.
  //    At this viewport the Name column squeezes to ~100px next to the
  //    fixed-width siblings, so a fixed +340px drag would undershoot the 500px
  //    bar. The wrapper's left edge stays fixed while the column grows
  //    rightward (card at scrollLeft 0). Asserted as a relationship, never
  //    exact px (font/viewport dependent).
  const box = (await handle.boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const headLeft = await page.getByRole('button', { name: /^Sort by name/ }).evaluate((el) => el.parentElement!.getBoundingClientRect().left)
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(headLeft + 640, cy, { steps: 10 })
  await page.mouse.up()
  // The row's name wrapper (the anchor's parent div) carries the minWidth.
  await expect.poll(() => anchor.evaluate((el) => parseInt(el.parentElement!.style.minWidth, 10) || 0)).toBeGreaterThanOrEqual(500)
  // The listing card became a horizontal scroller (scrollWidth > clientWidth)…
  await expect.poll(() => anchor.evaluate((el) => {
    const card = el.closest('.overflow-x-auto')
    return card ? card.scrollWidth - card.clientWidth : -1
  })).toBeGreaterThan(0)
  // …and scrolled fully right, the long name no longer truncates.
  await anchor.evaluate((el) => {
    const card = el.closest('.overflow-x-auto')
    if (card) card.scrollLeft = card.scrollWidth
  })
  await expect.poll(() => anchor.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)

  // 3.5 While the width is STORED (post-drag, pre-reset) the card carries
  //     overflow-x-auto, making it a clip ancestor for menu.tsx's popover —
  //     accepted in this user-chosen state, capped to the CARD bounds (tall
  //     here). The row menu must still open at natural height — at least two
  //     items' worth, never the 1px sliver of the v0.10.0 regression — and a
  //     real click must land on an item. 'History' is the harmless pick: it
  //     opens the read-only version drawer, closable without side effects.
  await page.getByRole('button', { name: `File ${LONG} actions` }).click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect.poll(() => menu.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(64)
  await page.getByRole('menuitem', { name: 'History' }).click()
  const drawer = page.getByRole('dialog', { name: 'Version history' })
  await expect(drawer).toBeVisible()
  await drawer.getByRole('button', { name: 'Close version history' }).click()
  await expect(drawer).toHaveCount(0)

  // 4. The width survives a reload (localStorage, not component state) — same
  //    context, so the session cookie carries the sign-in through the reload.
  await page.reload()
  await waitForHydration(page)
  await expect.poll(() => page.getByRole('link', { name: LONG }).evaluate((el) => parseInt(el.parentElement!.style.minWidth, 10) || 0)).toBeGreaterThanOrEqual(500)

  // 5. Double-click resets: the minWidth is gone AND the card is back to the
  //    default (unclipped) state — no overflow-x-auto ancestor at all, which is
  //    also what keeps the wave-18 menu-clip contract in the default state.
  await handle.dblclick()
  await expect.poll(() => anchor.evaluate((el) => el.parentElement!.style.minWidth)).toBe('')
  await expect.poll(() => anchor.evaluate((el) => el.closest('.overflow-x-auto') === null)).toBe(true)
})
