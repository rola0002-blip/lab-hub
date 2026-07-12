import { test, expect } from '@playwright/test'
import { wipe, runWizard, signIn, ADMIN, createIssueViaUI } from './helpers'

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
  // route end-to-end, asserting BOTH the POST and the card's resulting column.
  await page.goto('/issues')
  await page.getByRole('button', { name: 'Board' }).click()
  const grip = page.getByRole('button', { name: 'Reorder COL-1' })
  await grip.focus()
  await page.keyboard.press('Space')       // lift
  await page.keyboard.press('ArrowRight')  // move toward the adjacent Todo column
  const [moveRes] = await Promise.all([
    page.waitForResponse((r) => /\/api\/issues\/[^/]+\/move/.test(r.url()) && r.request().method() === 'POST'),
    page.keyboard.press('Space'),          // drop → fires POST /api/issues/<id>/move
  ])
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
