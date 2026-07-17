import { test, expect, type Browser, type Page } from '@playwright/test'
import { wipe, runWizard, signIn, signOut, ADMIN, createMemberViaInvite, acceptInvite } from './helpers'

// Per-context client IP so better-auth's per-IP sign-in/up rate limit never trips
// across this serial suite (mirrors messaging.spec.ts). Offset the sequence so it
// never collides with the messaging suite's buckets on a shared runner.
let ipSeq = 100
async function newPage(browser: Browser): Promise<Page> {
  ipSeq += 1
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `10.20.${ipSeq}.7` } })
  return ctx.newPage()
}

test.describe.configure({ mode: 'serial' })
test.beforeEach(async () => { await wipe() })

const PASS = 'MemberPass!1234'
const GUEST = { email: 'gina@lab.test', name: 'Gina Guest' }

async function admin(browser: Browser): Promise<Page> {
  const page = await newPage(browser)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  return page
}

async function createChannel(page: Page, name: string): Promise<string> {
  await page.goto('/chat')
  await page.getByRole('button', { name: 'Browse or create channels' }).click()
  await page.getByRole('button', { name: 'New channel' }).click()
  await page.getByPlaceholder('e.g. cvd-lab').fill(name)
  await page.getByRole('button', { name: 'Create channel', exact: true }).click()
  await page.waitForURL(/\/chat\/[^/]+$/)
  return new URL(page.url()).pathname.split('/').pop()!
}

async function openPalette(page: Page) {
  // Gate on the header pill so the client shell has rendered, then press ⌘K /
  // Ctrl-K (useGlobalHotkey accepts either modifier). Retry the one-shot keypress
  // until the dialog appears — it can fire a frame before the effect subscribes.
  await expect(page.getByRole('button', { name: /Search LabHub/ })).toBeVisible()
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10_000 })
}

test('⌘K palette: type a channel name and Enter navigates to that channel', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  const cid = await createChannel(page, 'photonics')

  // Prove the palette is global (lives in the app shell, not just /chat): jump
  // from a NON-chat page.
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/dashboard$/)

  await openPalette(page)
  const input = page.getByRole('combobox', { name: 'Search LabHub' })
  await input.fill('photon')
  await expect(page.getByRole('option', { name: /photonics/ })).toBeVisible()

  await input.press('Enter')
  await page.waitForURL('**/chat/' + cid)
  await expect(page.getByRole('heading', { name: '#photonics' })).toBeVisible()

  await page.context().close()
})

test('⌘K palette: a guest is never offered Admin/People destinations', async ({ browser }) => {
  test.setTimeout(90_000)
  const adminPage = await admin(browser)
  const token = await createMemberViaInvite(adminPage, GUEST.email, 'guest')
  const pageG = await newPage(browser)
  await acceptInvite(pageG, token, GUEST.name, PASS) // lands on /dashboard, signed in

  await openPalette(pageG)
  const input = pageG.getByRole('combobox', { name: 'Search LabHub' })

  // Positive control: an always-on page IS reachable for a guest.
  await input.fill('dash')
  await expect(pageG.getByRole('option', { name: /Dashboard/ })).toBeVisible()

  // Role-gated exactly like the sidebar: admin-only + non-guest pages are absent.
  await input.fill('settings')
  await expect(pageG.getByText('No matches')).toBeVisible()
  await input.fill('equipment')
  await expect(pageG.getByText('No matches')).toBeVisible()
  await input.fill('people')
  await expect(pageG.getByRole('option', { name: /^People/ })).toHaveCount(0)

  await pageG.context().close()
  await adminPage.context().close()
})

test('profile: rename + accent switch persist across reload', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)

  // Open the profile from the top-bar user menu (not a nav item).
  await page.goto('/dashboard')
  await page.getByRole('button', { name: 'Your account' }).click()
  await page.getByRole('menuitem', { name: 'Profile' }).click()
  await page.waitForURL('**/profile')

  // Rename.
  const nameInput = page.getByLabel('Full name')
  await nameInput.fill('Roland Renamed')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Profile saved.')).toBeVisible()

  // Switch accent to Crimson (a radio in the Appearance radiogroup).
  await page.getByRole('radio', { name: 'Crimson' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'crimson')

  // Reload — both persist (name is server-side; accent via localStorage + account).
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'crimson')
  await expect(page.getByLabel('Full name')).toHaveValue('Roland Renamed')

  // Signing out must drop this device's stored theme/accent so a shared machine
  // never leaks the previous user's appearance to the next signer-in.
  await signOut(page)
  await page.waitForURL('**/sign-in')
  // The device's stored appearance is gone — this is the leak fix: without it the
  // next user's own server prefs would lose to the leftover localStorage value.
  expect(await page.evaluate(() => localStorage.getItem('accent'))).toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBeNull()
  // On the next full document load the pre-paint boot script re-reads the (now
  // empty) localStorage and no longer stamps the crimson accent onto the page.
  await page.reload()
  await expect(page.locator('html')).not.toHaveAttribute('data-accent', 'crimson')

  await page.context().close()
})

test('theme toggle persists across reload', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  const html = page.locator('html')
  await page.goto('/dashboard')
  // Fresh context defaults to light (no stored choice, Playwright's light scheme).
  await expect(html).toHaveAttribute('data-theme', 'light')
  // The toggle's accessible name names the TARGET theme.
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  // Persisted via localStorage (pre-paint) + account, so a reload stays dark.
  await page.reload()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await expect(html).toHaveAttribute('data-theme', 'light')
  await page.context().close()
})

test('grouped message body fills the content column, not the 36px avatar gutter (no hover)', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  await createChannel(page, 'grouping')
  const box = page.getByPlaceholder('Write a message…')

  // Leading message (has the avatar in column 1).
  await box.fill('first message in the run')
  await box.press('Enter')
  await expect(page.getByText('first message in the run')).toBeVisible()
  await expect(box).toHaveValue('')

  // Second message from the SAME author within 5 min → renders GROUPED: no avatar,
  // column 1 holds only a hover-reveal <time>. Make it long + multi-line so a
  // gutter-trapped body would collapse to a ~one-word-per-line sliver.
  const l1 = 'This is a deliberately long grouped reply line that must fill the wide content column'
  const l2 = 'and here is a second physical line of the very same grouped message body'
  await box.fill(l1)
  await box.press('Shift+Enter')
  await box.pressSequentially(l2)
  await box.press('Enter')
  await expect(box).toHaveValue('')

  const row = page.locator('[data-msg-id]').last()
  const body = row.locator('p.whitespace-pre-wrap')
  await expect(body).toContainText(l1)
  await expect(body).toContainText(l2) // confirms this is the multi-line grouped body

  // Park the pointer away from the row: the bug only manifests WITHOUT hover (an
  // accidental hover would reveal the <time>, occupy column 1, and mask it).
  await page.mouse.move(0, 0)
  const rowBox = await row.boundingBox()
  const bodyBox = await body.boundingBox()
  expect(rowBox).not.toBeNull()
  expect(bodyBox).not.toBeNull()
  // Broken code auto-places the body into the 36px gutter track (~a few % of the
  // pane). The fix pins it to column 2, so it spans most of the row width.
  expect(bodyBox!.width).toBeGreaterThan(rowBox!.width * 0.6)

  await page.context().close()
})

test('keyboard-only reply: ↑ into the log, r opens the thread, type + send', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  await createChannel(page, 'keys')
  const box = page.getByPlaceholder('Write a message…')
  await box.fill('root message for keyboard reply')
  await box.press('Enter')
  await expect(page.getByText('root message for keyboard reply')).toBeVisible()
  // Wait for the send to settle so the composer is genuinely empty — the ↑ guard
  // only fires on an empty composer (the message renders optimistically first).
  await expect(box).toHaveValue('')

  // ↑ in the (now empty) composer enters the message log at the newest row…
  await box.focus()
  await box.press('ArrowUp')
  await expect(page.locator('[data-msg-id]').last()).toBeFocused()
  // …then `r` opens the thread on the focused message (pane-scoped hotkey).
  await page.keyboard.press('r')
  const threadBox = page.getByPlaceholder('Reply in thread…')
  await expect(threadBox).toBeVisible()
  await threadBox.fill('keyboard-only reply body')
  await threadBox.press('Enter')
  // Wait for the reply to settle so the thread composer clears — otherwise
  // getByText would also match the textarea's lingering value.
  await expect(threadBox).toHaveValue('')
  await expect(page.getByText('keyboard-only reply body')).toBeVisible()
  await expect(page.getByRole('button', { name: /1 reply/ })).toBeVisible()
  await page.context().close()
})

test('deep-link scrolls the linked message into view', async ({ browser }) => {
  test.setTimeout(120_000)
  const page = await admin(browser)
  const cid = await createChannel(page, 'links')
  // Seed via the API (fast, no composer busy-race): a target then enough fillers
  // to push it well above the fold.
  const first = await page.request.post('/api/chat/messages', { data: { conversationId: cid, body: 'deep link target' } })
  expect(first.status()).toBe(201)
  const targetId = (await first.json()).message.id as string
  // 24 fillers (25 sends total) stays under the 30/60s per-user send limit while
  // comfortably overflowing the message pane so the target sits above the fold.
  for (let i = 0; i < 24; i++) {
    const r = await page.request.post('/api/chat/messages', { data: { conversationId: cid, body: `filler ${i}` } })
    expect(r.status()).toBe(201)
  }

  const target = page.locator(`[data-msg-id="${targetId}"]`)
  // Opening the channel normally lands at the newest message; the target is above the fold.
  await page.goto('/chat/' + cid)
  await expect(page.getByText('filler 23')).toBeVisible()
  await expect(target).not.toBeInViewport()
  // The ?msg= deep-link consumes the target and scrolls it into view.
  await page.goto(`/chat/${cid}?msg=${targetId}`)
  await expect(target).toBeInViewport()
  await page.context().close()
})

test('mobile 320px: no horizontal overflow and the thread opens as a focus-trapped drawer', async ({ browser }) => {
  test.setTimeout(90_000)
  // A phone-width context (also the 400%-zoom equivalent of a desktop width).
  ipSeq += 1
  const ctx = await browser.newContext({
    viewport: { width: 320, height: 640 },
    extraHTTPHeaders: { 'x-forwarded-for': `10.20.${ipSeq}.7` },
  })
  const page = await ctx.newPage()
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)

  // Open a channel: lands on /chat/<cid>, where the conversation-list rail
  // collapses (list/pane swap) so there is no second shrink-0 column.
  await createChannel(page, 'mobile')
  const box = page.getByPlaceholder('Write a message…')
  await box.fill('mobile root message')
  await box.press('Enter')
  await expect(page.getByText('mobile root message')).toBeVisible()
  await expect(box).toHaveValue('')

  const docScrollWidth = () => page.evaluate(() => document.documentElement.scrollWidth)
  // No horizontal page scroll at 320px with a conversation open.
  expect(await docScrollWidth()).toBeLessThanOrEqual(320)

  // Open the thread without hover (no pointer hover on a phone): focus the newest
  // message row (its roving tab stop), then the pane's `r` hotkey opens its thread.
  const row = page.locator('[data-msg-id]').last()
  await row.focus()
  await expect(row).toBeFocused()
  await page.keyboard.press('r')

  // The thread is now a modal drawer (role=dialog "Thread"): visible, still no
  // horizontal overflow, and it trapped focus (useFocusTrap moved focus inside it).
  const drawer = page.getByRole('dialog', { name: 'Thread' })
  await expect(drawer).toBeVisible()
  await expect(page.getByPlaceholder('Reply in thread…')).toBeVisible()
  expect(await docScrollWidth()).toBeLessThanOrEqual(320)
  const focusTrapped = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"][aria-label="Thread"]')
    return !!dlg && !!document.activeElement && dlg.contains(document.activeElement)
  })
  expect(focusTrapped).toBe(true)

  // Escape dismisses the drawer.
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()

  await ctx.close()
})
