import { test, expect, type Browser, type Page } from '@playwright/test'
import { wipe, seedSystem, runWizard, signIn, ADMIN, createMemberViaInvite, acceptInvite, db } from './helpers'

// v0.12 "manual project arrangement": /projects is the lab's own shelf order, not a
// computed ranking. These journeys drive the two affordances that write it (the Move
// menu and the keyboard drag), the boundary no-ops, and the two states where the
// arrangement is deliberately NOT offered (guests, any active filter).
//
// Per-context client IP so better-auth's per-IP sign-in/up limit never trips. Bands
// 10.10 / 10.20 / 10.30 / 10.40 / 10.41 / 10.50 / 10.60 / 10.70 are taken by the other
// suites, so this file claims 10.80.x and stays out of every other bucket.
let ipSeq = 0
async function newPage(browser: Browser): Promise<Page> {
  ipSeq += 1
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `10.80.${ipSeq}.7` } })
  return ctx.newPage()
}

// Serial + ONE-TIME wipe/seed: test 1 provisions the org + admin (workers:1 → one
// shared database), the later tests only sign in. NEVER a beforeEach(wipe) — that
// would truncate `user` between tests and every later signIn would hang.
test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => { await wipe(); await seedSystem() })

const GUEST_PASS = 'GuestPass!1234'
const A = 'Alpha rig', B = 'Bravo rig', C = 'Charlie rig'

// Next's dev SSR leaves a HIDDEN duplicate of the streamed tree in `div#S:0` at body
// level, so CSS/text locators (unlike role locators, which skip the a11y-hidden copy)
// resolve twice under strict mode. Every CSS locator here is rooted at <main>.
const main = (page: Page) => page.getByRole('main')
// v0.12 card anatomy: the card root is a plain <div> hosting the controls, and the
// LINK moved onto the name inside the <h2>. `a[href^="/projects/"] h2` matches nothing.
const names = (page: Page) => main(page).locator('h2 a[href^="/projects/"]').allTextContents()
const grips = (page: Page) => page.getByRole('button', { name: /^Reorder / })
const moveMenus = (page: Page) => page.getByRole('button', { name: /^Move / })

async function adminId(): Promise<string> {
  return (await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })).id
}

// Each journey owns the WHOLE grid: 1-based positions and the "of N" announcements are
// only meaningful when the page shows exactly the cards this test seeded, so the table
// is cleared first (ProjectUpdate cascades; no issues are created in this file).
// `Project.rank` is NOT NULL with no default, so every raw create supplies an explicit
// literal — 'B' < 'C' < 'D' byte-wise, which is the COLLATE "C" order Postgres reads.
async function seedGrid(rows: { name: string; rank: string; leadId?: string }[]): Promise<string[]> {
  await db.project.deleteMany({})
  const ids: string[] = []
  for (const r of rows) {
    const p = await db.project.create({ data: { name: r.name, rank: r.rank, leadId: r.leadId ?? null } })
    ids.push(p.id)
  }
  return ids
}

// ─────────────────────────────────────────────────────────────────────────────
test('1: the Move menu rearranges the grid and the new order survives a reload', async ({ browser }) => {
  test.setTimeout(120_000)
  const page = await newPage(browser)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)

  await seedGrid([{ name: A, rank: 'B' }, { name: B, rank: 'C' }, { name: C, rank: 'D' }])
  await page.goto('/projects')
  await expect.poll(() => names(page)).toEqual([A, B, C])

  // Pointer-free path: the same four commands the keyboard drag writes.
  await page.getByRole('button', { name: `Move ${A}` }).click()
  await page.getByRole('menu').getByRole('menuitem', { name: 'Move to end' }).click()
  await expect.poll(() => names(page), { timeout: 15_000 }).toEqual([B, C, A])

  // The reload is the real assertion: it re-reads `Project.rank` from Postgres, so an
  // optimistic paint that never reached the server could not survive it.
  await page.reload()
  await expect.poll(() => names(page)).toEqual([B, C, A])
  await page.context().close()
})

// ─────────────────────────────────────────────────────────────────────────────
test('2: a keyboard drag from the grip rearranges the grid and the new order survives a reload', async ({ browser }) => {
  test.setTimeout(120_000)
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)

  await seedGrid([{ name: A, rank: 'B' }, { name: B, rank: 'C' }, { name: C, rank: 'D' }])
  await page.goto('/projects')
  await expect.poll(() => names(page)).toEqual([A, B, C])

  // dnd-kit's own screen-reader live region — the helper's proven selector
  // (e2e/helpers.ts:136). ProjectsGrid overrides every announcement, so the default
  // "was moved over droppable area" line the board helper waits on never appears here.
  const live = page.locator('[id^="DndLiveRegion"]')
  await page.getByRole('button', { name: `Reorder ${C}` }).focus()
  await page.keyboard.press('Space')                                       // lift
  // Lift acknowledged: 'position 3 of 3' is the ORIGIN position, carried by both the
  // pickup line and the self-over line that replaces it once the rects are measured —
  // so this gate cannot race whichever of the two is current.
  await expect(live).toContainText('position 3 of 3')
  // The KeyboardSensor measures droppable rects a frame AFTER the lift, so an arrow
  // fired immediately is a no-op. Press until the move actually lands, gating on the
  // TARGET-SPECIFIC line — a generic /position \d+ of \d+/ is already satisfied by the
  // pickup announcement, which would let the drop fire before any arrow took effect.
  // Row-major rect order: left = earlier.
  await expect(async () => {
    await page.keyboard.press('ArrowLeft')
    await expect(live).toContainText('moved to position 2 of 3', { timeout: 800 })
  }).toPass({ timeout: 10_000 })
  await page.keyboard.press('Space')                                       // drop
  await expect(live).toContainText('dropped at position 2 of 3')
  await expect.poll(() => names(page), { timeout: 15_000 }).toEqual([A, C, B])

  await page.reload()
  await expect.poll(() => names(page)).toEqual([A, C, B])
  await page.context().close()
})

// ─────────────────────────────────────────────────────────────────────────────
test('3: the Move menu disables the commands that would be no-ops at the boundaries', async ({ browser }) => {
  test.setTimeout(120_000)
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)

  await seedGrid([{ name: A, rank: 'B' }, { name: B, rank: 'C' }, { name: C, rank: 'D' }])
  await page.goto('/projects')
  await expect.poll(() => names(page)).toEqual([A, B, C])

  // First card: nowhere earlier to go.
  await page.getByRole('button', { name: `Move ${A}` }).click()
  const firstMenu = page.getByRole('menu')
  await expect(firstMenu.getByRole('menuitem', { name: 'Move to front' })).toBeDisabled()
  await expect(firstMenu.getByRole('menuitem', { name: 'Move earlier' })).toBeDisabled()
  await expect(firstMenu.getByRole('menuitem', { name: 'Move later' })).toBeEnabled()
  await expect(firstMenu.getByRole('menuitem', { name: 'Move to end' })).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)

  // Last card: nowhere later to go. (One-from-last leaves `later` and `end` equal and
  // BOTH enabled by design — only the true boundary disables them.)
  await page.getByRole('button', { name: `Move ${C}` }).click()
  const lastMenu = page.getByRole('menu')
  await expect(lastMenu.getByRole('menuitem', { name: 'Move later' })).toBeDisabled()
  await expect(lastMenu.getByRole('menuitem', { name: 'Move to end' })).toBeDisabled()
  await expect(lastMenu.getByRole('menuitem', { name: 'Move to front' })).toBeEnabled()
  await expect(lastMenu.getByRole('menuitem', { name: 'Move earlier' })).toBeEnabled()
  await page.keyboard.press('Escape')
  await page.context().close()
})

// ─────────────────────────────────────────────────────────────────────────────
test('4: a guest reads the arrangement and is offered no way to change it', async ({ browser }) => {
  test.setTimeout(150_000)
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)

  await seedGrid([{ name: A, rank: 'B' }, { name: B, rank: 'C' }, { name: C, rank: 'D' }])
  const token = await createMemberViaInvite(page, 'guest@lab.test', 'guest')
  const gp = await newPage(browser)
  await acceptInvite(gp, token, 'Guesty', GUEST_PASS)

  await gp.goto('/projects')
  await expect(gp.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect.poll(() => names(gp)).toEqual([A, B, C])          // reads the same shelf order
  await expect(grips(gp)).toHaveCount(0)
  await expect(moveMenus(gp)).toHaveCount(0)

  // The name is still the link out of the card — losing the controls must not cost a
  // guest the navigation the card exists for.
  const first = main(gp).locator('h2 a[href^="/projects/"]').first()
  const href = await first.getAttribute('href')
  await first.click()
  await expect(gp).toHaveURL(new RegExp(`${href}$`))
  await expect(gp.getByRole('heading', { name: A })).toBeVisible()
  await gp.context().close()
  await page.context().close()
})

// ─────────────────────────────────────────────────────────────────────────────
test('5: an active filter hides the arrangement controls, and clearing it brings them back', async ({ browser }) => {
  test.setTimeout(120_000)
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  const me = await adminId()

  // The filtered card must genuinely LAND in the on_track bucket, or the filter shows
  // nothing and "zero Reorder buttons" passes vacuously. healthBucket needs BOTH an
  // effective lead (the admin: not banned, not system, not a guest) and a fresh
  // ON_TRACK update — without either it falls to no_lead / no_update.
  const [onTrackId] = await seedGrid([
    { name: 'On-track rig', rank: 'B', leadId: me },
    { name: 'Unowned rig', rank: 'C' },                  // no lead → the no_lead bucket
  ])
  await db.projectUpdate.create({ data: { projectId: onTrackId, authorId: me, health: 'ON_TRACK', body: 'Two clean transfers this week.' } })

  await page.goto('/projects')
  await expect(page.getByRole('button', { name: 'Reorder On-track rig' })).toBeVisible()

  await page.goto('/projects?health=on_track')
  await expect(page.getByRole('heading', { name: 'On-track rig' })).toBeVisible()   // the filter really matched
  await expect(page.getByRole('heading', { name: 'Unowned rig' })).toHaveCount(0)   // and really narrowed
  await expect(grips(page)).toHaveCount(0)
  await expect(moveMenus(page)).toHaveCount(0)

  await page.goto('/projects')
  await expect(page.getByRole('button', { name: 'Reorder On-track rig' })).toBeVisible()
  await expect(grips(page)).toHaveCount(2)
  await page.context().close()
})
