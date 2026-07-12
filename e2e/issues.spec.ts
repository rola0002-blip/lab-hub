import { test, expect } from '@playwright/test'
import { wipe, runWizard, signIn, ADMIN, createIssueViaUI, keyboardMoveCardRight, db } from './helpers'

test.describe.configure({ mode: 'serial' })
test.beforeEach(async () => { await wipe() })

test('issue lifecycle: project, create, board move, comment, complete, autolink', async ({ page }) => {
  test.setTimeout(150_000)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)

  // Project CRUD via the UI (AC1: projects can be created by admins/members).
  await page.goto('/projects')
  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByLabel('Name').fill('SP4 E2E Project')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/projects\/[^/]+$/)
  await expect(page.getByRole('heading', { name: 'SP4 E2E Project' })).toBeVisible()

  // Create the first issue FROM the project page — the composer pre-fills the project.
  await createIssueViaUI(page, 'Calibrate the SEM')
  await page.waitForURL('**/issues/COL-1')
  await expect(page.getByText('SP4 E2E Project')).toBeVisible() // properties panel shows the pre-filled project

  // Filter URL round-trips. `Status` is matched exactly so it hits the FilterBar
  // select and not the per-row "Status: Backlog" inline menu (whose aria-label
  // contains "Status").
  await page.goto('/issues')
  await page.getByLabel('Status', { exact: true }).selectOption('BACKLOG')
  await expect(page).toHaveURL(/status=BACKLOG/)
  await expect(page.getByText('Calibrate the SEM')).toBeVisible()
  await page.getByLabel('Status', { exact: true }).selectOption('') // clear the filter for the board

  // Seed a second issue in the ADJACENT Todo column so the keyboard move has a
  // concrete cross-column target to land in (a single-card board has no sortable to
  // move onto, which is why the prior version asserted nothing).
  await createIssueViaUI(page, 'Anneal the sample') // COL-2, lands on its detail
  await page.getByRole('button', { name: 'Set status' }).click()
  await page.getByRole('menuitem', { name: 'Todo' }).click()
  await expect(page.getByRole('button', { name: 'Set status' })).toContainText('Todo')

  // Board view: keyboard-only cross-column move (grip → Space lift → ArrowRight into
  // the Todo column → Space drop). Exercises @dnd-kit's KeyboardSensor AND the /move
  // route end-to-end, asserting BOTH the POST and the card's resulting column. The
  // helper gates on dnd-kit's live-region so the ArrowRight lands after the sensor has
  // measured the droppable rects (pressing it too early is a no-op that drops the card
  // back in its own column). `overId` is the id of whatever card currently sits in the
  // Todo column — derived, not a hardcoded identifier, so the gate can't drift.
  await page.goto('/issues')
  await page.getByRole('button', { name: 'Board' }).click()
  const todoNeighbour = await db.issue.findFirstOrThrow({ where: { status: 'TODO' }, select: { id: true } })
  const moveRes = await keyboardMoveCardRight(page, 'Reorder COL-1', todoNeighbour.id)
  expect(moveRes.ok()).toBeTruthy()
  // COL-1 now lives in the Todo column (the keyboard DnD changed its status).
  await expect(
    page.locator('section[data-col-status="TODO"]').getByRole('link', { name: 'COL-1', exact: true }),
  ).toBeVisible()

  // Detail: comment + complete.
  await page.goto('/issues/COL-1')
  await page.getByLabel('Write a comment').fill('Started calibration')
  await page.getByRole('button', { name: 'Comment' }).click()
  await expect(page.getByText('Started calibration')).toBeVisible()
  await page.getByRole('button', { name: 'Set status' }).click()
  await page.getByRole('menuitem', { name: 'Done' }).click()
  await expect(page.getByRole('button', { name: 'Set status' })).toContainText('Done')

  // Chat autolink round-trips to a struck-through Done pill (same channel-creation
  // selectors as e2e/a11y.spec.ts's createChannel helper).
  await page.goto('/chat')
  await page.getByRole('button', { name: 'Browse or create channels' }).click()
  await page.getByRole('button', { name: 'New channel' }).click()
  await page.getByPlaceholder('e.g. cvd-lab').fill('sp4-e2e')
  await page.getByRole('button', { name: 'Create channel', exact: true }).click()
  await page.waitForURL(/\/chat\/[^/]+$/)
  const box = page.getByPlaceholder('Write a message…')
  await box.fill('fixed in COL-1')
  await box.press('Enter')
  const pill = page.getByRole('link', { name: /COL-1/ })
  await expect(pill).toBeVisible()
  await expect(pill).toHaveAttribute('href', '/issues/COL-1')
  await expect(pill.locator('.line-through')).toBeVisible() // Done → struck-through title
  await pill.click()
  await page.waitForURL('**/issues/COL-1') // round-trip lands on the issue
  // The detail renders the title as an editable <input value> for admins (getByText
  // never matches an input value) — assert the value, and that the round-trip landed
  // on the Done issue (ties the struck-through chat pill to the detail's status).
  await expect(page.getByRole('textbox', { name: 'Issue title' })).toHaveValue('Calibrate the SEM')
  await expect(page.getByRole('button', { name: 'Set status' })).toContainText('Done')
})

test('c shortcut never stacks the composer over an open modal', async ({ page }) => {
  test.setTimeout(90_000)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)

  // (a) Project-composer modal open with focus on its Cancel BUTTON — not an input,
  // so use-global-hotkey's INPUT/TEXTAREA guard does not apply; only issue-hotkeys'
  // `[role=dialog][aria-modal]` check stops `c` from stacking the create-issue modal.
  await page.goto('/projects')
  await page.getByRole('button', { name: 'New project' }).click()
  await expect(page.getByRole('dialog', { name: 'New project' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).focus()
  await page.keyboard.press('c')
  await expect(page.getByRole('heading', { name: 'New issue' })).toHaveCount(0) // no create-issue modal stacked
  await expect(page.getByRole('dialog')).toHaveCount(1)                          // still only the project composer
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // (b) ⌘K command palette open — `c` still must not raise the composer.
  await page.goto('/issues')
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10_000 })
  await page.keyboard.press('c')
  await expect(page.getByRole('heading', { name: 'New issue' })).toHaveCount(0)
})

test('create-issue modal: status menu is fully visible and clickable, not clipped by the dialog', async ({ page }) => {
  test.setTimeout(90_000)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)

  // Open the global create-issue composer.
  await page.goto('/issues')
  await page.getByRole('button', { name: 'New issue' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New issue' })
  await expect(dialog).toBeVisible()

  // Open the Status property menu. The chip is the LEFTMOST element in the property
  // row — the worst case for the shared Menu, whose popover previously anchored
  // `right-0` (growing leftward) and flowed downward, so it spilled past the dialog's
  // left and bottom edges and was clipped by the panel's `overflow` scroll box. `exact`
  // avoids the per-row "Status: <label>" menus that live behind the modal on /issues.
  await dialog.getByRole('button', { name: 'Status', exact: true }).click()

  // The menu (and specifically the mid-list "In Progress" item) must be visible — a
  // clipped popover would report a zero/off-panel rect and fail actionability.
  const inProgress = dialog.getByRole('menuitem', { name: 'In Progress' })
  await expect(inProgress).toBeVisible()

  // The item's on-screen rect must sit fully inside BOTH the viewport and the dialog's
  // box: any clip on the left/bottom (the original bug) pushes it outside these bounds.
  const vp = page.viewportSize()!
  const item = (await inProgress.boundingBox())!
  const panel = (await dialog.boundingBox())!
  expect(item).not.toBeNull()
  expect(item.x).toBeGreaterThanOrEqual(0)
  expect(item.y).toBeGreaterThanOrEqual(0)
  expect(item.x + item.width).toBeLessThanOrEqual(vp.width)
  expect(item.y + item.height).toBeLessThanOrEqual(vp.height)
  expect(item.x).toBeGreaterThanOrEqual(panel.x - 1)
  expect(item.x + item.width).toBeLessThanOrEqual(panel.x + panel.width + 1)
  expect(item.y).toBeGreaterThanOrEqual(panel.y - 1)
  expect(item.y + item.height).toBeLessThanOrEqual(panel.y + panel.height + 1)

  // Clicking it (Playwright actionability fails on occluded/clipped targets) selects
  // the status: the chip must now read "In Progress".
  await inProgress.click()
  await expect(dialog.getByRole('button', { name: 'Status', exact: true })).toContainText('In Progress')
})
