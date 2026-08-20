import { test, expect, type Browser, type Page } from '@playwright/test'
import { wipe, runWizard, signIn, ADMIN } from './helpers'

// Regression for the v0.9.4 "when I change the status, the drop down list is blocked"
// report. The inline status chips on the issues LIST rows and BOARD cards sit at the
// LEFT of their row/card, but the shared Menu defaulted to a right-anchored popover
// (growing leftward). At phone width that popover ran off the LEFT edge (measured
// x=-79 on the list, x=-76 on the board) so its items were clipped off-screen and
// unusable. The shared Menu now flips the horizontal anchor to the side with room
// before paint; these specs open the status menu on each inline surface at 375px and
// assert the popover sits fully inside the viewport and is actually clickable (a
// clipped popover reports a negative x and fails Playwright actionability). Detail +
// create-modal status menus were never clipped and stay covered by issues.spec.ts.

const PHONE = { width: 375, height: 812 }

// Per-context client IP so better-auth's per-IP sign-in limit never trips across this
// serial suite (mirrors redesign.spec.ts); a distinct range avoids collisions with it.
let ipSeq = 40
async function phonePage(browser: Browser): Promise<Page> {
  ipSeq += 1
  const ctx = await browser.newContext({ viewport: PHONE, extraHTTPHeaders: { 'x-forwarded-for': `10.40.${ipSeq}.7` } })
  return ctx.newPage()
}

async function seed(page: Page, n: number, status: string) {
  for (let i = 0; i < n; i++) {
    const r = await page.request.post('/api/issues', { data: { title: `Repro issue ${i}`, status } })
    expect(r.status()).toBe(200)
  }
}

// The open status popover must sit fully inside the viewport — the bug pushed it to x<0.
async function expectMenuOnScreen(page: Page) {
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  const vp = page.viewportSize()!
  const box = (await menu.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1)
}

test.describe.configure({ mode: 'serial' })
test.beforeEach(async () => { await wipe() })

test('list-row status menu is not clipped off-screen at phone width', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await phonePage(browser)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  await seed(page, 6, 'TODO')

  await page.goto('/issues')
  // First list row's status chip (the leftmost interactive cluster — worst case).
  await page.getByRole('button', { name: /^Status: / }).first().click()
  await expectMenuOnScreen(page)
  // Clickable (Playwright actionability fails on a clipped/occluded target) → the
  // status is applied and the row re-groups under the new status.
  await page.getByRole('menuitem', { name: 'In Progress' }).click()
  await expect(page.getByRole('button', { name: 'Status: In Progress' }).first()).toBeVisible()

  await page.context().close()
})

test('board-card status menu is not clipped off-screen at phone width', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await phonePage(browser)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  await seed(page, 4, 'BACKLOG') // BACKLOG is the first board column → visible without scrolling

  await page.goto('/issues')
  await page.getByRole('button', { name: 'Board' }).click()
  await page.getByRole('button', { name: /^Status: / }).first().click()
  await expectMenuOnScreen(page)
  // Selecting an item proves it is reachable (not clipped).
  await page.getByRole('menuitem', { name: 'In Progress' }).click()
  await expect(page.getByRole('menu')).toBeHidden()

  await page.context().close()
})
