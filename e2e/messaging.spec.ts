import { test, expect, type Browser, type Page } from '@playwright/test'
import { wipe, runWizard, signIn, ADMIN, createMemberViaInvite, acceptInvite } from './helpers'

// Per-context client IP. better-auth rate-limits /sign-in/email and /sign-up/email at 10/60 s
// keyed by client IP; on localhost every request would otherwise share one bucket and the
// 11-test suite trips the limit mid-run. Giving each context a unique single-IP
// x-forwarded-for buckets each separately (better-auth trusts a lone forwarded IP when no
// trustedProxies are set), so every sign-in/sign-up sits at count 1.
let ipSeq = 0
async function newPage(browser: Browser): Promise<Page> {
  ipSeq += 1
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `10.10.${ipSeq}.7` } })
  return ctx.newPage()
}

// Six end-to-end messaging journeys. Serial + wipe-before-each mirrors journeys.spec.ts.
//
// SSE subscription model (verified against the running app — see task-15-report.md):
//  - A live SSE subscription only receives `msg`/`rx`/… events for conversations in its
//    `conversationIds` snapshot, which is reloaded on a `member` event.
//  - `join`/`addMembers`/`createChannel`/`getOrCreateDm` all emit `member`, so a participant's
//    pre-existing subscription self-updates and a freshly-created conversation appears live in
//    their list (journey 6 asserts this for a DM with NO navigation by the recipient). The
//    channel-create journeys still navigate into the new channel, then assert genuine live SSE
//    delivery (no further reload) across it.
//  - `notify()` emits `{ t: 'notif' }`, so the Bell badge upgrades to instant: journey 3 asserts
//    the badge within a few seconds, proving the live SSE push rather than the Bell's 30 s poll.

test.describe.configure({ mode: 'serial' })
test.beforeEach(async () => { await wipe() })

const PASS = 'MemberPass!1234'
const BOB = { email: 'bob@lab.test', name: 'Bob Member' }
const GUEST = { email: 'gina@lab.test', name: 'Gina Guest' }

// Fresh admin: own context (unique IP), wizard + signed in, returns the admin page.
async function admin(browser: Browser): Promise<Page> {
  const page = await newPage(browser)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  return page
}

// Invite `who` in `role`, accept in a fresh context (unique IP), return the signed-in member's page.
async function joinAs(adminPage: Page, browser: Browser, who: { email: string; name: string }, role: 'member' | 'guest'): Promise<Page> {
  const token = await createMemberViaInvite(adminPage, who.email, role)
  const p = await newPage(browser)
  await acceptInvite(p, token, who.name, PASS)
  return p
}

// Admin creates a public channel via the sidebar "+" dialog; ends freshly navigated INTO the
// channel so the creator's SSE subscription includes it (createChannel emits no `member`).
async function createChannel(page: Page, name: string): Promise<string> {
  await page.goto('/chat')
  await page.getByRole('button', { name: 'Browse or create channels' }).click()
  await page.getByRole('button', { name: 'New channel' }).click()
  await page.getByPlaceholder('e.g. cvd-lab').fill(name)
  await page.getByRole('button', { name: 'Create channel', exact: true }).click()
  await page.waitForURL(/\/chat\/[^/]+$/)
  const cid = new URL(page.url()).pathname.split('/').pop()!
  await page.goto('/chat/' + cid) // establish the creator's live subscription
  await expect(page.getByRole('heading', { name: '#' + name })).toBeVisible()
  return cid
}

// Member browses public channels and joins `cid`; the join emits a `member` event that
// reloads the joiner's live subscription. Ends viewing the channel.
async function joinChannel(page: Page, cid: string, name: string) {
  await page.goto('/chat')
  await page.getByRole('button', { name: 'Browse or create channels' }).click()
  await page.getByRole('button', { name: 'Join' }).click()
  await page.waitForURL('**/chat/' + cid)
  await expect(page.getByRole('heading', { name: '#' + name })).toBeVisible()
}

async function send(page: Page, text: string) {
  const box = page.getByPlaceholder('Write a message…')
  await box.fill(text)
  await box.press('Enter')
}

test('1: channel create + two-context live messaging', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  const pageB = await joinAs(page, browser, BOB, 'member')
  const cid = await createChannel(page, 'lab')
  await joinChannel(pageB, cid, 'lab')

  await send(page, 'hello from A')
  await expect(pageB.getByText('hello from A')).toBeVisible() // live via SSE, no reload

  await send(pageB, 'hi from B')
  await expect(page.getByText('hi from B')).toBeVisible() // live via SSE, no reload

  await pageB.context().close()
  await page.context().close()
})

test('2: thread reply + typing indicator', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  const pageB = await joinAs(page, browser, BOB, 'member')
  const cid = await createChannel(page, 'lab')
  await joinChannel(pageB, cid, 'lab')

  await send(page, 'thread root')
  await expect(pageB.getByText('thread root')).toBeVisible()

  // B opens the thread on the root message and replies
  await pageB.getByText('thread root').hover()
  await pageB.getByTitle('Reply in thread').click()
  const threadBox = pageB.getByPlaceholder('Reply in thread…')
  await threadBox.fill('in thread')
  await threadBox.press('Enter')

  // A sees the live reply count on the root, opens the thread, sees the reply
  await expect(page.getByText('1 reply')).toBeVisible()
  await page.getByText('1 reply').click()
  await expect(page.getByText('in thread')).toBeVisible()

  // Typing indicator: B types in the main composer without sending; A sees it live
  await pageB.getByPlaceholder('Write a message…').fill('typing now')
  await expect(page.getByText(/is typing/)).toBeVisible()

  await pageB.context().close()
  await page.context().close()
})

test('3: mention → bell notification', async ({ browser }) => {
  test.setTimeout(120_000)
  const page = await admin(browser)
  const pageB = await joinAs(page, browser, BOB, 'member')
  const cid = await createChannel(page, 'lab')
  await joinChannel(pageB, cid, 'lab')
  // Reload A into the channel AFTER Bob joined so A's server-rendered member list (and thus
  // the @-mention autocomplete) includes Bob.
  await page.goto('/chat/' + cid)
  await expect(page.getByRole('heading', { name: '#lab' })).toBeVisible()

  // Bob keeps the app open on the dashboard
  await pageB.goto('/dashboard')
  const bell = pageB.getByRole('button', { name: 'Notifications', exact: true })
  await expect(bell).toBeVisible()

  // A @-mentions Bob via the autocomplete popup and sends
  const box = page.getByPlaceholder('Write a message…')
  await box.pressSequentially('@Bob')
  await page.getByRole('button', { name: 'Bob Member' }).click()
  await box.press('Enter')

  // The bell badge reflects the mention live: notify() emits `{ t: 'notif' }`, so the Bell
  // reloads over SSE within seconds. The tight timeout proves the live path, not the 30 s poll.
  await expect(bell).toContainText(/[1-9]/, { timeout: 5_000 })
  await bell.click()
  await expect(pageB.getByText('You were mentioned')).toBeVisible()

  await pageB.context().close()
  await page.context().close()
})

test('4: guest isolation, then live add', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  const cid = await createChannel(page, 'lab')
  await send(page, 'cryostat calibration log') // searchable content that lives in #lab

  const pageG = await joinAs(page, browser, GUEST, 'guest')

  // Guest sees no channels and no create affordance
  await pageG.goto('/chat')
  await expect(pageG.getByRole('heading', { name: 'Channels' })).toBeVisible()
  await expect(pageG.getByRole('button', { name: 'Browse or create channels' })).toHaveCount(0)
  await expect(pageG.getByText('#lab')).toHaveCount(0)

  // Direct URL to a channel the guest is not a member of → app 404
  await pageG.goto('/chat/' + cid)
  await expect(pageG.getByText('This page could not be found')).toBeVisible()

  // Search for channel content the guest cannot access → no hits (membership-scoped)
  await pageG.goto('/chat')
  const search = pageG.getByPlaceholder('Search messages…')
  await search.click()
  await search.fill('cryostat')
  await expect(pageG.getByText('No matches.')).toBeVisible()
  await search.press('Escape')

  // Admin adds the guest via the Members… dialog
  await page.goto('/chat/' + cid)
  await page.getByRole('button', { name: 'Conversation menu' }).click()
  await page.getByRole('button', { name: 'Members' }).click()
  await page.getByRole('button', { name: 'Gina Guest' }).click()
  await page.getByRole('button', { name: /^Add/ }).click()

  // Channel appears live in the guest's list (member event → refresh) and opens
  const chan = pageG.getByRole('link', { name: '#lab' })
  await expect(chan).toBeVisible()
  await chan.click()
  await expect(pageG.getByRole('heading', { name: '#lab' })).toBeVisible()
  await expect(pageG.getByText('cryostat calibration log')).toBeVisible()

  await pageG.context().close()
  await page.context().close()
})

test('5: edit / delete / react round-trips', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  const pageB = await joinAs(page, browser, BOB, 'member')
  const cid = await createChannel(page, 'lab')
  await joinChannel(pageB, cid, 'lab')

  await send(page, 'tyop')
  await expect(pageB.getByText('tyop')).toBeVisible()

  // A edits the message; B sees the new text + "(edited)" live
  await page.getByText('tyop').hover()
  await page.getByTitle('Edit').click()
  const editBox = page.locator('textarea:not([placeholder])')
  await editBox.fill('typo fixed')
  await editBox.press('Enter')
  await expect(pageB.getByText('typo fixed')).toBeVisible()
  await expect(pageB.getByText('(edited)')).toBeVisible()

  // B reacts 👍; A sees the reaction pill with count 1 live
  await pageB.getByText('typo fixed').hover()
  await pageB.getByTitle('React 👍').click()
  await expect(page.getByRole('button').filter({ hasText: '👍' }).filter({ hasText: '1' })).toBeVisible()

  // A deletes the message; both sides see the tombstone
  await page.getByText('typo fixed').hover()
  await page.getByTitle('Delete').click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText('message deleted')).toBeVisible()
  await expect(pageB.getByText('message deleted')).toBeVisible()

  await pageB.context().close()
  await page.context().close()
})

test('6: DM with unread badge', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  const pageB = await joinAs(page, browser, BOB, 'member')

  // A sits on the chat home with a live SSE subscription BEFORE the DM exists.
  await page.goto('/chat')
  await expect(page.getByRole('heading', { name: 'Channels' })).toBeVisible()

  // B starts a DM to A ("Roland") and sends the first message
  await pageB.goto('/chat')
  await pageB.getByRole('button', { name: 'New direct message' }).click()
  await pageB.getByRole('button', { name: 'Roland' }).click()
  await pageB.getByRole('button', { name: 'Start' }).click()
  await pageB.waitForURL(/\/chat\/[^/]+$/)
  const dmId = new URL(pageB.url()).pathname.split('/').pop()!
  await send(pageB, 'dm hello')

  // The DM appears live in A's list (getOrCreateDm's member event → store refresh) with an
  // unread badge of 1 — A does NOT navigate; this proves the live conversation-creation seam.
  const dmRow = page.getByRole('link', { name: /Bob Member/ })
  await expect(dmRow).toBeVisible()
  await expect(dmRow).toContainText('1')

  // A opens the DM → markRead clears the badge
  await dmRow.click()
  await expect(page.getByText('dm hello')).toBeVisible()
  await expect(page.getByRole('link', { name: /Bob Member/ })).not.toContainText('1')

  // B re-opens the DM (establishes its live subscription), then A replies → B sees it live
  await pageB.goto('/chat/' + dmId)
  await expect(pageB.getByText('dm hello')).toBeVisible()
  await send(page, 'reply from A')
  await expect(pageB.getByText('reply from A')).toBeVisible()

  await pageB.context().close()
  await page.context().close()
})
