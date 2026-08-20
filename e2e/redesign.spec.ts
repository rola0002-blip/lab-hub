import { test, expect, type Browser, type Page } from '@playwright/test'
import pkg from '../package.json'
import { wipe, runWizard, signIn, signOut, ADMIN, createMemberViaInvite, acceptInvite, waitForHydration } from './helpers'

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
  await waitForHydration(page)
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
  await acceptInvite(pageG, token, GUEST.name, PASS) // lands on /issues/me, signed in

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

  // Leading message (has the avatar in column 1). Scope to the log: an unscoped
  // getByText also matches the composer textarea's own content during the
  // optimistic-append → POST-confirm window (cleared only after the 201).
  const log = page.getByLabel('Messages', { exact: true })
  await box.fill('first message in the run')
  await box.press('Enter')
  await expect(log.getByText('first message in the run')).toBeVisible()
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
  // Scoped to the log — see the grouped-message test: an unscoped getByText also
  // matches the composer's own draft during the optimistic-append → 201 window.
  const log = page.getByLabel('Messages', { exact: true })
  await box.fill('root message for keyboard reply')
  await box.press('Enter')
  await expect(log.getByText('root message for keyboard reply')).toBeVisible()
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
  await expect(page.getByText('keyboard-only reply body')).toBeVisible() // safe: composer already settled
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

// v0.14.1 F2: the shell had the DOCUMENT as its only scrollport and the rail stretched
// to the page's full height, so a long page carried the rail's footer (avatar, Give
// feedback, version) — and the top bar — off the bottom/top of the screen. Both are
// `md:sticky` now, and the rail's nav (whose overflow-y-auto was inert under an
// unbounded parent) becomes the scroller instead.
test('shell: the sidebar rail and the top bar stay pinned while a long page scrolls', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  // md+ (1280 ≥ 768, where the pin is gated) but SHORT — so the page AND the rail's
  // own nav both overflow, which is exactly the reported condition.
  await page.setViewportSize({ width: 1280, height: 400 })
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: 'Welcome, Roland' }).first()).toBeVisible()

  // Fail fast: with nothing to scroll, every assertion below would pass vacuously.
  expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

  // The two rail-footer controls the bug pushed off-screen.
  await expect(page.getByText(`v${pkg.version}`)).toBeInViewport()
  await expect(page.getByRole('button', { name: 'Give feedback' })).toBeInViewport()
  // The rail is one viewport tall now, so its nav is a real bounded scroller.
  const nav = page.getByRole('navigation', { name: 'Primary' })
  expect(await nav.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  // …and the top bar is pinned too (the same complaint, one report earlier).
  await expect(page.getByRole('search')).toBeInViewport()

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
  // Scoped to the log (optimistic-append window can match the composer draft).
  await expect(page.getByLabel('Messages', { exact: true }).getByText('mobile root message')).toBeVisible()
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

// F12: the Files toolbar's new-window button opens window.location.href verbatim,
// so whatever listing URL you're on carries into the popup; the originating tab
// stays put. Exercised at the bare /files root — a ?folder= listing rides the
// same pass-through but is not asserted here.
test('files: open in new window opens the same listing in a popup', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  await page.goto('/files')
  await expect(page.getByRole('button', { name: 'Open in new window' })).toBeVisible()

  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Open in new window' }).click()
  const popup = await popupPromise
  await expect(popup).toHaveURL(/\/files/)
  await popup.close()
  await expect(page).toHaveURL(/\/files/)
  await page.context().close()
})

// F2: row-level Mute/Unmute in the conversation list — the ⋯ trigger is
// hover/keyboard-only by design (touch users get the header menu).
test('chat: row-level Mute/Unmute from the conversation list', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  await createChannel(page, 'rowmute')
  const row = page.getByRole('link', { name: /rowmute/ })
  await expect(row).toBeVisible()

  // Hover reveals the row's ⋯ menu; muting stamps the row's BellOff glyph.
  await row.hover()
  await page.getByRole('button', { name: 'rowmute actions' }).click()
  await page.getByRole('menuitem', { name: 'Mute' }).click()
  await expect(row.locator('[aria-label="Muted"]')).toBeVisible()

  // Unmute from the same row menu restores the prior state.
  await row.hover()
  await page.getByRole('button', { name: 'rowmute actions' }).click()
  await page.getByRole('menuitem', { name: 'Unmute' }).click()
  await expect(row.locator('[aria-label="Muted"]')).toHaveCount(0)

  await page.context().close()
})

// W4-A2: row-level Favorite — the Star glyph appears and the row floats above
// unfavorited channels in the SAME section; unfavorite restores the position.
test('chat: row-level Favorite floats the channel above unfavorited ones', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  await createChannel(page, 'aaa-unfaved')
  await createChannel(page, 'zzz-faved')
  const rowA = page.getByRole('link', { name: /aaa-unfaved/ })
  const rowZ = page.getByRole('link', { name: /zzz-faved/ })
  await expect(rowA).toBeVisible()
  await expect(rowZ).toBeVisible()

  // Alphabetical baseline: aaa renders above zzz.
  expect((await rowA.boundingBox())!.y).toBeLessThan((await rowZ.boundingBox())!.y)

  // Favorite 'zzz-faved' from its row menu → star glyph + floats above aaa.
  await rowZ.hover()
  await page.getByRole('button', { name: 'zzz-faved actions' }).click()
  await page.getByRole('menuitem', { name: 'Favorite' }).click()
  await expect(rowZ.locator('[aria-label="Favorited"]')).toBeVisible()
  await expect(async () => {
    expect((await rowZ.boundingBox())!.y).toBeLessThan((await rowA.boundingBox())!.y)
  }).toPass({ timeout: 10_000 })

  // Unfavorite from the same row menu → star gone, alphabetical order restored.
  await rowZ.hover()
  await page.getByRole('button', { name: 'zzz-faved actions' }).click()
  await page.getByRole('menuitem', { name: 'Unfavorite' }).click()
  await expect(rowZ.locator('[aria-label="Favorited"]')).toHaveCount(0)
  await expect(async () => {
    expect((await rowA.boundingBox())!.y).toBeLessThan((await rowZ.boundingBox())!.y)
  }).toPass({ timeout: 10_000 })

  await page.context().close()
})

// F2: Leave channel via the row menu. Leaving a NON-open row keeps the current
// pane; leaving the open conversation lands back on the chat index.
test('chat: leave via the row menu — other rows keep the pane, the open row returns to /chat', async ({ browser }) => {
  test.setTimeout(120_000)
  const page = await admin(browser)
  const stayId = await createChannel(page, 'stayhere')
  await createChannel(page, 'goner')
  // Re-open 'stayhere' so the pane shows it while 'goner' is left from the rail.
  await page.goto(`/chat/${stayId}`)
  await expect(page.getByRole('heading', { name: '#stayhere' })).toBeVisible()

  await page.getByRole('link', { name: /goner/ }).hover()
  await page.getByRole('button', { name: 'goner actions' }).click()
  await page.getByRole('menuitem', { name: 'Leave channel' }).click()
  await expect(page.getByRole('link', { name: /goner/ })).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`/chat/${stayId}$`))

  // Leaving the conversation you are reading redirects to the chat index.
  await page.getByRole('link', { name: /stayhere/ }).hover()
  await page.getByRole('button', { name: 'stayhere actions' }).click()
  await page.getByRole('menuitem', { name: 'Leave channel' }).click()
  await page.waitForURL('**/chat')
  await expect(page.getByRole('link', { name: /stayhere/ })).toHaveCount(0)

  await page.context().close()
})

// Task-7 carry-over: a file dropped OUTSIDE [data-chat-pane] (here: the
// conversation rail) must be cancelled by the chat shell's window-level guard
// instead of navigating the tab to the dropped file. A synthetic cancelable drop
// proves the guard prevents the default; unprevented, Chromium would treat a
// Files drop on non-dropzone chrome as top-level navigation.
test('chat: dropping a file on the conversation rail is cancelled (no tab navigation)', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  // The guard lives in the chat shell, mounted for every /chat route — an open
  // conversation is not required for it, but the rail drop target is most
  // realistic with a channel behind it.
  await createChannel(page, 'dropguard')
  await expect(page.getByRole('heading', { name: '#dropguard' })).toBeVisible()

  const rail = page.getByRole('navigation', { name: 'Conversations' })
  await expect(rail).toBeVisible()
  const url = page.url()
  const prevented = await rail.evaluate((el) => {
    const dt = new DataTransfer()
    dt.items.add(new File(['drop guard'], 'drop-guard.txt', { type: 'text/plain' }))
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })
    el.dispatchEvent(ev)
    return ev.defaultPrevented
  })
  // defaultPrevented is the real instrument: an untrusted synthetic event never
  // triggers browser default actions, so the URL assert below is
  // belt-and-suspenders documentation of the guard's user-visible contract.
  expect(prevented).toBe(true)
  expect(page.url()).toBe(url)

  await page.context().close()
})

// F7: post-login landing is the last-open conversation (landingHrefFor), and it
// re-validates at read — leaving the conversation reverts the landing to the
// personal task list without anyone clearing the remembered id.
test('F7: sign-in lands on the last-open conversation; leaving reverts to /issues/me', async ({ browser }) => {
  test.setTimeout(120_000)
  const page = await admin(browser)
  const cid = await createChannel(page, 'landing')

  // Last-open channel is remembered → the next sign-in lands back in it.
  await signOut(page)
  await page.waitForURL('**/sign-in')
  await signIn(page, ADMIN.email, ADMIN.password)
  await expect(page).toHaveURL(new RegExp(`/chat/${cid}$`))
  await expect(page.getByRole('heading', { name: '#landing' })).toBeVisible()

  // Leave via the row's ⋯ menu (the open row redirects to the chat index); the
  // membership is gone, so landingHrefFor falls back to /issues/me on the next
  // sign-in even though the remembered id still points here.
  await page.getByRole('link', { name: /landing/ }).hover()
  await page.getByRole('button', { name: 'landing actions' }).click()
  await page.getByRole('menuitem', { name: 'Leave channel' }).click()
  await page.waitForURL('**/chat')

  await signOut(page)
  await page.waitForURL('**/sign-in')
  await signIn(page, ADMIN.email, ADMIN.password)
  await expect(page).toHaveURL(/\/issues\/me$/)
  await expect(page.getByRole('heading', { name: 'My issues' })).toBeVisible()

  await page.context().close()
})

// F7: notification sounds — an opt-in per-device toggle (role=switch, never
// colour-alone) whose localStorage choice survives reload; the server column is
// only the cross-device seed.
test('F7: profile sounds toggle stays on across reload', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)

  await page.goto('/profile')
  const toggle = page.getByRole('switch', { name: 'Notification sounds' })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')

  // Reload: localStorage 'sounds' === '1' wins on the device, so the switch the
  // server seeded as false still renders on.
  await page.reload()
  await expect(page.getByRole('switch', { name: 'Notification sounds' })).toHaveAttribute('aria-checked', 'true')

  await page.context().close()
})
