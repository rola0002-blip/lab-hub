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
  await page.waitForURL('**/issues/LAB-1')
  await expect(page.getByText('SP4 E2E Project')).toBeVisible() // properties panel shows the pre-filled project

  // v0.9.5: the composer now defaults new issues to Todo. This lifecycle test relies on
  // LAB-1 starting in Backlog — the BACKLOG filter round-trip just below and the later
  // Backlog→Todo keyboard board move — so move it back to Backlog explicitly.
  await page.getByRole('button', { name: 'Set status' }).click()
  await page.getByRole('menuitem', { name: 'Backlog' }).click()
  await expect(page.getByRole('button', { name: 'Set status' })).toContainText('Backlog')

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
  await createIssueViaUI(page, 'Anneal the sample') // LAB-2, lands on its detail
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
  const moveRes = await keyboardMoveCardRight(page, 'Reorder LAB-1', todoNeighbour.id)
  expect(moveRes.ok()).toBeTruthy()
  // LAB-1 now lives in the Todo column (the keyboard DnD changed its status).
  await expect(
    page.locator('section[data-col-status="TODO"]').getByRole('link', { name: 'LAB-1', exact: true }),
  ).toBeVisible()

  // Detail: comment + complete.
  await page.goto('/issues/LAB-1')
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
  await box.fill('fixed in LAB-1')
  await box.press('Enter')
  const pill = page.getByRole('link', { name: /LAB-1/ })
  await expect(pill).toBeVisible()
  await expect(pill).toHaveAttribute('href', '/issues/LAB-1')
  await expect(pill.locator('.line-through')).toBeVisible() // Done → struck-through title
  await pill.click()
  await page.waitForURL('**/issues/LAB-1') // round-trip lands on the issue
  // The detail renders the title as an editable <input value> for admins (getByText
  // never matches an input value) — assert the value, and that the round-trip landed
  // on the Done issue (ties the struck-through chat pill to the detail's status).
  await expect(page.getByRole('textbox', { name: 'Issue title' })).toHaveValue('Calibrate the SEM')
  await expect(page.getByRole('button', { name: 'Set status' })).toContainText('Done')
})

test('c shortcut: global quick-capture that respects the typing and modal guards', async ({ page }) => {
  test.setTimeout(120_000)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)

  // Global (v0.9.5): the pathname gate is gone, so `c` raises the composer from a
  // non-issues page (the dashboard), not only /issues and /projects. Retry the press
  // until the composer is up (the global listener attaches on hydration; a `c` while
  // the modal is open is guarded, so repeats can't stack).
  await page.goto('/dashboard')
  const composer = page.getByRole('dialog', { name: 'New issue' })
  await expect(async () => {
    await page.keyboard.press('c')
    await expect(composer).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10_000 })
  await page.keyboard.press('Escape')
  await expect(composer).toHaveCount(0)

  // Typing guard HOLDS in chat: `c` typed into the message textarea inserts the
  // character and does NOT open the composer (use-global-hotkey's TEXTAREA guard).
  await page.goto('/chat')
  await page.getByRole('button', { name: 'Browse or create channels' }).click()
  await page.getByRole('button', { name: 'New channel' }).click()
  await page.getByPlaceholder('e.g. cvd-lab').fill('c-guard')
  await page.getByRole('button', { name: 'Create channel', exact: true }).click()
  await page.waitForURL(/\/chat\/[^/]+$/)
  const box = page.getByPlaceholder('Write a message…')
  await box.click()
  await box.pressSequentially('abc') // real keydowns, including 'c'
  await expect(box).toHaveValue('abc')
  await expect(page.getByRole('dialog', { name: 'New issue' })).toHaveCount(0)

  // Modal guard (a): project-composer modal open with focus on its Cancel BUTTON —
  // not an input, so use-global-hotkey's INPUT/TEXTAREA guard does not apply; only
  // issue-hotkeys' `[role=dialog][aria-modal]` check stops `c` from stacking.
  await page.goto('/projects')
  await page.getByRole('button', { name: 'New project' }).click()
  await expect(page.getByRole('dialog', { name: 'New project' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).focus()
  await page.keyboard.press('c')
  await expect(page.getByRole('heading', { name: 'New issue' })).toHaveCount(0) // no create-issue modal stacked
  await expect(page.getByRole('dialog')).toHaveCount(1)                          // still only the project composer
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Typing guard extends to native <select> (v0.9.5, reviewer Low #1): a focused
  // filter <select> is a typing target (typeahead), so `c` must NOT raise the
  // composer — use-global-hotkey's guard now excludes SELECT alongside
  // INPUT/TEXTAREA/contenteditable. First prove the global `c` listener is live on
  // this page (retry until the composer opens, then close it) so the non-opening
  // below is attributable to the guard and not to an unhydrated listener; on the
  // pre-fix code (guard missing SELECT) focusing the select and pressing `c`
  // opened the composer.
  await page.goto('/issues')
  await expect(async () => {
    await page.keyboard.press('c')
    await expect(composer).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10_000 })
  await page.keyboard.press('Escape')
  await expect(composer).toHaveCount(0)
  await page.getByLabel('Status', { exact: true }).focus() // the filter-bar Status <select>
  await page.keyboard.press('c')
  await expect(composer).toHaveCount(0) // guard holds: no composer while a <select> has focus

  // Modal guard (b): ⌘K command palette open — `c` still must not raise the composer.
  await page.goto('/issues')
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10_000 })
  await page.keyboard.press('c')
  await expect(page.getByRole('heading', { name: 'New issue' })).toHaveCount(0)
})

test('quick-capture defaults the assignee to the current user; New issue button leaves it unset', async ({ page }) => {
  test.setTimeout(90_000)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password) // the admin is "Roland"
  await page.goto('/issues')

  // Quick capture via the `c` shortcut → assignee pre-filled to the current user…
  // The global `c` listener attaches on hydration; /issues is a heavier page, so retry
  // the keypress until the composer is up (mirrors the ⌘K palette settle idiom; a `c`
  // while the modal is already open is guarded, so repeats can't stack).
  const dialog = page.getByRole('dialog', { name: 'New issue' })
  await expect(async () => {
    await page.keyboard.press('c')
    await expect(dialog).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10_000 })
  await expect(dialog.getByRole('button', { name: 'Assignee' })).toContainText('Roland')
  // …but it is only a default — the picker stays editable (Unassigned still selectable).
  await dialog.getByRole('button', { name: 'Assignee' }).click()
  await dialog.getByRole('menuitem', { name: 'Unassigned' }).click()
  await expect(dialog.getByRole('button', { name: 'Assignee' })).toContainText('Unassigned')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // The "New issue" button is NOT quick capture → assignee stays unset.
  await page.getByRole('button', { name: 'New issue' }).first().click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Assignee' })).toContainText('Unassigned')
})

test('composer defaults new issues to Todo; Backlog stays selectable', async ({ page }) => {
  test.setTimeout(90_000)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/issues')

  // Default status is Todo (was Backlog).
  await page.getByRole('button', { name: 'New issue' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New issue' })
  await expect(dialog.getByRole('button', { name: 'Status', exact: true })).toContainText('Todo')

  // Backlog is still selectable — a default, not a restriction.
  await dialog.getByRole('button', { name: 'Status', exact: true }).click()
  await dialog.getByRole('menuitem', { name: 'Backlog' }).click()
  await expect(dialog.getByRole('button', { name: 'Status', exact: true })).toContainText('Backlog')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // Accepting the Todo default persists as TODO (the create path honours it end-to-end).
  await createIssueViaUI(page, 'Default-status probe')
  const created = await db.issue.findFirstOrThrow({ where: { title: 'Default-status probe' }, select: { status: true } })
  expect(created.status).toBe('TODO')
})

test('due dates: overdue reads "Overdue", due-today reads "Today", on list rows (desktop + mobile) and board cards', async ({ page }) => {
  test.setTimeout(90_000)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  const admin = await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })
  // Titles deliberately avoid the words "Overdue"/"Today" so the assertions can only
  // be satisfied by the due-date chip, never the title text.
  await db.issue.create({ data: { title: 'Furnace calibration', creatorId: admin.id, assigneeId: admin.id, status: 'TODO', rank: 'a0', dueDate: new Date(Date.now() - 3 * 86_400_000) } })
  await db.issue.create({ data: { title: 'Sample annealing', creatorId: admin.id, assigneeId: admin.id, status: 'TODO', rank: 'a1', dueDate: new Date() } })

  // List rows (desktop).
  await page.goto('/issues')
  await expect(page.getByRole('listitem').filter({ hasText: 'Furnace calibration' })).toContainText('Overdue')
  await expect(page.getByRole('listitem').filter({ hasText: 'Sample annealing' })).toContainText('Today')

  // Mobile layout: below md the due cell is DELIBERATELY hidden (v0.14 responsive
  // sweep, spec S1 — the two-line phone row keeps priority/status/identifier/title and
  // assignee, and drops labels/project/due). It stays in the DOM, so this asserts
  // HIDDEN-NESS, not absence: `toContainText` reads textContent and would pass on a
  // display:none cell, which is exactly the vacuous assertion this replaces. A phone
  // user gets overdue context from the board card instead — covered immediately below.
  await page.setViewportSize({ width: 375, height: 800 })
  const dueCell = page.getByRole('listitem').filter({ hasText: 'Furnace calibration' }).getByText('Overdue')
  await expect(dueCell).toHaveCount(1)
  await expect(dueCell).toBeHidden()
  await page.setViewportSize({ width: 1280, height: 800 })

  // Board cards — previously hid due dates entirely; now surfaced + colour-coded.
  await page.getByRole('button', { name: 'Board' }).click()
  const todo = page.locator('section[data-col-status="TODO"]')
  await expect(todo).toContainText('Overdue')
  await expect(todo).toContainText('Today')
})

test('filter bar: due-date quick filter narrows the list and Clear filters resets it', async ({ page }) => {
  test.setTimeout(90_000)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  const admin = await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })
  await db.issue.create({ data: { title: 'Past due task', creatorId: admin.id, status: 'TODO', rank: 'b0', dueDate: new Date(Date.now() - 3 * 86_400_000) } })
  await db.issue.create({ data: { title: 'No due date task', creatorId: admin.id, status: 'TODO', rank: 'b1' } })

  await page.goto('/issues')
  await expect(page.getByText('Past due task')).toBeVisible()
  await expect(page.getByText('No due date task')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0) // nothing to clear yet

  // Overdue quick filter → only the overdue issue; the choice round-trips through the URL.
  await page.getByLabel('Due date').selectOption('overdue')
  await expect(page).toHaveURL(/due=overdue/)
  await expect(page.getByText('Past due task')).toBeVisible()
  await expect(page.getByText('No due date task')).toHaveCount(0)

  // Clear filters now shows and, in one click, drops the due filter and restores the full list.
  const clear = page.getByRole('button', { name: 'Clear filters' })
  await expect(clear).toBeVisible()
  await clear.click()
  await expect(page).not.toHaveURL(/due=/)
  await expect(page.getByText('Past due task')).toBeVisible()
  await expect(page.getByText('No due date task')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0)
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

test('pinned projects: pin from the project page, chip filters /issues/me, unpin', async ({ page }) => {
  test.setTimeout(120_000)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)

  // (a) Create a project via the UI (same flow as the lifecycle test), then pin it
  // from the header's kebab menu — the F3 item is available to every role.
  await page.goto('/projects')
  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByLabel('Name').fill('Pin E2E Project')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/projects\/[^/]+$/)
  await expect(page.getByRole('heading', { name: 'Pin E2E Project' })).toBeVisible()
  await page.getByRole('button', { name: 'Project actions' }).click()
  await page.getByRole('menuitem', { name: 'Pin to My issues' }).click()
  await expect(page.getByText('Pinned to My issues.')).toBeVisible()
  // The refreshed header now offers the inverse action.
  await expect(page.getByRole('button', { name: 'Project actions' })).toBeVisible()
  await page.getByRole('button', { name: 'Project actions' }).click()
  await expect(page.getByRole('menuitem', { name: 'Unpin from My issues' })).toBeVisible()
  await page.keyboard.press('Escape')

  // (b) The chip row on /issues/me — clicking the chip filters via ?project= (the
  // existing filter machinery, no new filter code).
  await page.goto('/issues/me')
  const chip = page.getByRole('link', { name: 'Pin E2E Project' })
  await expect(chip).toBeVisible()
  await chip.click()
  await expect(page).toHaveURL(/\/issues\/me\?project=/)
  await expect(chip).toBeVisible() // still rendered, now in its active/selected style

  // (c) Unpin from the manage menu — the chip disappears after the refresh. The
  // manage menu is deliberately quiet on success (rail precedent: the visible
  // chip change IS the feedback; only failures toast, e.g. the MAX_PINS cap) —
  // unlike the project-page kebab, which does toast 'Unpinned.'
  await page.getByRole('button', { name: 'Manage pinned projects' }).click()
  await page.getByRole('menuitem', { name: 'Unpin Pin E2E Project' }).click()
  await expect(chip).toHaveCount(0)
})

test('project labels: create on the project page, apply via the properties menu, detach on project move, filter by label', async ({ page }) => {
  test.setTimeout(150_000)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)

  // Alpha hosts the scoped label; Beta is the move destination (db-seeded with a
  // trailing rank so it sorts after the UI-created Alpha without another wizard).
  await page.goto('/projects')
  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByLabel('Name').fill('F5 Alpha')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/projects\/[^/]+$/)
  await db.project.create({ data: { name: 'F5 Beta', rank: 'zz' } })
  // A workspace-global label, seeded via db (global creation has no management UI).
  await db.label.create({ data: { name: 'triage', color: '--status-done' } })

  // (a) The Labels section on the project page mints the scoped label.
  await page.getByRole('button', { name: 'Label', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New label' })
  await dialog.getByLabel('Label name').fill('procurement')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByLabel('Project labels').getByText('procurement')).toBeVisible()

  // (b) An issue created from the project page (pre-filled project), then both the
  // scoped and the global label applied through the properties Labels menu.
  await createIssueViaUI(page, 'Procure boron source') // lands on its detail page
  const detailUrl = page.url()
  await page.getByRole('button', { name: 'Set labels' }).click()
  await page.getByRole('menuitem', { name: 'procurement', exact: true }).click()
  // Wait for the first label's round-trip to land before the second pick: the
  // toggle's `applied` set comes from the server-rendered issue DTO, so a second
  // selection dispatched before that refresh resolves computes its next-set from
  // the stale (still label-less) state and REPLACES procurement instead of
  // adding to it.
  await expect(page.getByRole('button', { name: 'Set labels' })).toContainText('procurement')
  await page.getByRole('button', { name: 'Set labels' }).click()
  await page.getByRole('menuitem', { name: 'triage', exact: true }).click()
  const labelsTrigger = page.getByRole('button', { name: 'Set labels' })
  await expect(labelsTrigger).toContainText('procurement')
  await expect(labelsTrigger).toContainText('triage')

  // (c) The filter bar's Label select (grouped Workspace/projects) filters by the
  // scoped label — the option value is the label id, resolved from the db.
  const procurement = await db.label.findFirstOrThrow({ where: { name: 'procurement' } })
  await page.goto('/issues')
  await page.getByLabel('Label', { exact: true }).selectOption(procurement.id)
  await expect(page).toHaveURL(/label=/)
  await expect(page.getByText('Procure boron source')).toBeVisible()
  await page.getByLabel('Label', { exact: true }).selectOption('')
  await expect(page).not.toHaveURL(/label=/)

  // (d) Moving the issue to another project via the properties Project menu
  // detaches the stale scoped label and keeps the global one.
  await page.goto(detailUrl)
  await page.getByRole('button', { name: 'Set project' }).click()
  await page.getByRole('menuitem', { name: 'F5 Beta' }).click()
  await expect(page.getByRole('link', { name: 'F5 Beta' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Set labels' })).toContainText('triage')
  await expect(page.getByRole('button', { name: 'Set labels' })).not.toContainText('procurement')

  // (e) The detach round-trips: filtering by procurement now finds nothing.
  await page.goto('/issues')
  await page.getByLabel('Label', { exact: true }).selectOption(procurement.id)
  await expect(page.getByText('Procure boron source')).toHaveCount(0)
})
