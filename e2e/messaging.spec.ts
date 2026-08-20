import { test, expect, type Browser, type Page } from '@playwright/test'
import { wipe, runWizard, signIn, ADMIN, createMemberViaInvite, acceptInvite, db } from './helpers'

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

// The visible message list is role="log" aria-label="Messages". The sr-only
// #live-msgs announcer is ALSO role="log" (unnamed) and now carries the inbound
// body as "{author}: {body}", so an unscoped getByText(body) on the RECEIVING
// side matches twice. Scope inbound-body assertions to the visible list so they
// still prove the body rendered there (and stay strict-mode single-match).
const logMsg = (page: Page, text: string) => page.getByRole('log', { name: 'Messages' }).getByText(text)

test('1: channel create + two-context live messaging', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  const pageB = await joinAs(page, browser, BOB, 'member')
  const cid = await createChannel(page, 'lab')
  await joinChannel(pageB, cid, 'lab')

  await send(page, 'hello from A')
  await expect(logMsg(pageB, 'hello from A')).toBeVisible() // live via SSE, no reload

  await send(pageB, 'hi from B')
  await expect(logMsg(page, 'hi from B')).toBeVisible() // live via SSE, no reload

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
  await expect(logMsg(pageB, 'thread root')).toBeVisible()

  // B opens the thread on the root message and replies
  await logMsg(pageB, 'thread root').hover()
  await pageB.getByTitle('Reply in thread').click()
  const threadBox = pageB.getByPlaceholder('Reply in thread…')
  await threadBox.fill('in thread')
  await threadBox.press('Enter')

  // A sees the live reply count on the root facepile, opens the thread, sees the reply.
  // The facepile is now a button (overlapping avatars + "N replies" + last-reply time),
  // so target it by role/name rather than the bare text node.
  const facepile = page.getByRole('button', { name: /1 reply/ })
  await expect(facepile).toBeVisible()
  await facepile.click()
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
  // The channel row now renders a Hash icon + bare name (no literal "#"), so assert
  // the guest has no channel LINK named "lab" rather than the old "#lab" text.
  await expect(pageG.getByRole('link', { name: 'lab' })).toHaveCount(0)

  // Direct URL to a channel the guest is not a member of → app 404
  await pageG.goto('/chat/' + cid)
  await expect(pageG.getByText('This page could not be found')).toBeVisible()

  // Search for channel content the guest cannot access → no hits (membership-scoped)
  await pageG.goto('/chat')
  // The visible placeholder is now workspace-branded ("Search LabHub"); the
  // aria-label stays the stable "Search messages", so target by that.
  const search = pageG.getByLabel('Search messages')
  await search.click()
  await search.fill('cryostat')
  await expect(pageG.getByText('No matches')).toBeVisible() // no-results empty state
  await search.press('Escape')

  // Admin adds the guest via the Members… dialog
  await page.goto('/chat/' + cid)
  await page.getByRole('button', { name: 'Conversation menu' }).click()
  await page.getByRole('button', { name: 'Members' }).click()
  await page.getByRole('button', { name: 'Gina Guest' }).click()
  // Scope the Add to the dialog: the channel-intro also renders an "Add people"
  // button, so an unscoped /^Add/ would match two buttons.
  await page.getByRole('dialog').getByRole('button', { name: /^Add/ }).click()

  // Channel appears live in the guest's list (member event → refresh) and opens.
  // List row = Hash icon + bare name, so the link's accessible name is "lab".
  const chan = pageG.getByRole('link', { name: 'lab' })
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
  await expect(logMsg(pageB, 'tyop')).toBeVisible()

  // A edits the message via the ⋯ overflow menu; B sees the new text + "(edited)" live
  await page.getByText('tyop').hover()
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  const editBox = page.locator('textarea:not([placeholder])')
  await editBox.fill('typo fixed')
  await editBox.press('Enter')
  await expect(pageB.getByText('typo fixed')).toBeVisible()
  await expect(pageB.getByText('(edited)')).toBeVisible()

  // B reacts 👍 via the toolbar emoji picker; A sees the reaction pill with count 1 live
  await pageB.getByText('typo fixed').hover()
  await pageB.getByTitle('Add reaction').click()
  await pageB.getByRole('button', { name: 'react 👍' }).click()
  await expect(page.getByRole('button').filter({ hasText: '👍' }).filter({ hasText: '1' })).toBeVisible()

  // A deletes the message via the ⋯ overflow menu; both sides see the tombstone
  await page.getByText('typo fixed').hover()
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
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
  // The DM header shows the person (name via dmName), not the literal "Direct message".
  await expect(page.getByRole('heading', { name: 'Bob Member' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Bob Member/ })).not.toContainText('1')

  // B re-opens the DM (establishes its live subscription), then A replies → B sees it live
  await pageB.goto('/chat/' + dmId)
  await expect(pageB.getByText('dm hello')).toBeVisible()
  await send(page, 'reply from A')
  await expect(logMsg(pageB, 'reply from A')).toBeVisible()

  await pageB.context().close()
  await page.context().close()
})

// Regression (v0.9.5 fix 8): a failed reaction / edit / delete used to fail silently —
// the reaction POST had no ok-check or catch (an aborted request became an unhandled
// rejection) and edit/delete gave no feedback. Each must now surface a toast and leave
// the row recoverable. Aborting the specific request forces the failure deterministically.
// URL-anchored regexes keep the message-endpoint route (PATCH/DELETE) from also catching
// the …/reactions sub-path.
const REACTIONS_URL = /\/api\/chat\/messages\/[^/]+\/reactions$/
const MESSAGE_URL = /\/api\/chat\/messages\/[^/?]+$/

test('7: a failed reaction / edit / delete surfaces a toast (no silent failure)', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  await createChannel(page, 'lab')
  await send(page, 'network will fail')
  await expect(logMsg(page, 'network will fail')).toBeVisible()

  // Reaction: abort the POST → a toast, and the picker closes without a lozenge.
  await page.route(REACTIONS_URL, (r) => r.abort())
  await logMsg(page, 'network will fail').hover()
  await page.getByTitle('Add reaction').click()
  await page.getByRole('button', { name: 'react 👍' }).click()
  await expect(page.getByText('Could not update your reaction. Please try again.')).toBeVisible()
  await page.unroute(REACTIONS_URL)

  // Edit: abort the PATCH (let the GET refresh through) → a toast, and the editor stays
  // open with the draft intact (Save still visible). Cancel to restore the plain row.
  await page.route(MESSAGE_URL, (r) => (r.request().method() === 'PATCH' ? r.abort() : r.continue()))
  await logMsg(page, 'network will fail').hover()
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  const editBox = page.locator('textarea:not([placeholder])')
  await editBox.fill('edited but doomed')
  await editBox.press('Enter')
  await expect(page.getByText('Could not save your edit. Please try again.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible() // still editing, not dismissed
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.unroute(MESSAGE_URL)

  // Delete: abort the DELETE → a toast, and the message is NOT tombstoned.
  await page.route(MESSAGE_URL, (r) => (r.request().method() === 'DELETE' ? r.abort() : r.continue()))
  await logMsg(page, 'network will fail').hover()
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText('Could not delete the message. Please try again.')).toBeVisible()
  await expect(logMsg(page, 'network will fail')).toBeVisible()
  await expect(page.getByText('message deleted')).toHaveCount(0)
  await page.unroute(MESSAGE_URL)

  await page.context().close()
})

// F1 (drag-and-drop attachments): Playwright cannot synthesize a real OS drag, so
// build a DataTransfer in page context and dispatch dragover/drop on the pane's
// drop surface ([data-chat-pane], the column wrapping the log + composer that owns
// the pane-level handlers). The drop routes through the composer's shared validated
// intake: a real POST /api/chat/attachments → pending chip → sent message renders
// the attachment link chip in the timeline.
const TXT = { name: 'dropped-notes.txt', type: 'text/plain', body: 'dropped payload' }

function dispatchDrag(page: Page, type: 'dragover' | 'dragleave' | 'drop', file?: { name: string; type: string; body: string }) {
  return page.locator('[data-chat-pane]').evaluate((el, { type, file }) => {
    const dt = new DataTransfer()
    if (file) dt.items.add(new File([file.body], file.name, { type: file.type }))
    else dt.setData('text/plain', 'plain text only')
    el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, { type, file })
}

test('8: drop a file onto the pane to attach, then send', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  await createChannel(page, 'lab')

  // Hydration gate: createChannel's last step is a FRESH SSR load of the
  // channel, so at this point only the server-rendered DOM is proven visible.
  // On GitHub's 2-core ubuntu runner, a one-shot synthetic dragover dispatched
  // here can beat React hydration — the pane's onDragOver is not attached to
  // the fiber tree yet, the event is swallowed, and no amount of waiting
  // recovers it (a raw DOM listener on the pane sees dataTransfer.types
  // ['Files'] while the overlay never appears; fast machines always win the
  // race, which is why this only failed on CI). Retry dispatch+assert until
  // React actually answers, then clear the overlay via dragleave.
  await expect(async () => {
    await dispatchDrag(page, 'dragover', TXT)
    await expect(page.getByText('Drop to attach')).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  await dispatchDrag(page, 'dragleave')
  await expect(page.getByText('Drop to attach')).toHaveCount(0)

  // A text-only drag must NOT raise the drop overlay (files only). Now a
  // GENUINE negative: the gate above proved the pane is interactive, so a
  // no-overlay result really means the Files-only gate held.
  await dispatchDrag(page, 'dragover')
  await expect(page.getByText('Drop to attach')).toHaveCount(0)

  // A file drag raises the overlay anywhere over the pane…
  await dispatchDrag(page, 'dragover', TXT)
  await expect(page.getByText('Drop to attach')).toBeVisible()

  // …and dropping uploads the file: the composer's pending chip shows the filename.
  await dispatchDrag(page, 'drop', TXT)
  await expect(page.getByText('dropped-notes.txt')).toBeVisible()

  // Send: the message lands in the timeline with the attachment link chip.
  await send(page, 'file inbound')
  await expect(page.getByRole('link', { name: /dropped-notes\.txt/ })).toBeVisible()

  await page.context().close()
})

// F8: a thread reply bells the root author. Mirrors journey 3's live-bell
// assertion (the {t:notif} SSE push, not the 30 s poll) and proves the deep
// link: the row navigates to /chat/<cid>?msg=<replyId>.
test('9: thread reply → bell + deep-link', async ({ browser }) => {
  test.setTimeout(120_000)
  const page = await admin(browser)
  const pageB = await joinAs(page, browser, BOB, 'member')
  const cid = await createChannel(page, 'lab')
  await joinChannel(pageB, cid, 'lab')

  await send(page, 'thread root')
  await expect(logMsg(pageB, 'thread root')).toBeVisible()

  // A parks on the dashboard so the Bell is the delivery surface for the reply.
  await page.goto('/dashboard')
  const bell = page.getByRole('button', { name: 'Notifications', exact: true })
  await expect(bell).toBeVisible()

  // B opens the thread on A's root message and replies
  await logMsg(pageB, 'thread root').hover()
  await pageB.getByTitle('Reply in thread').click()
  const threadBox = pageB.getByPlaceholder('Reply in thread…')
  await threadBox.fill('in thread ping')
  await threadBox.press('Enter')

  // The bell badge reflects the thread reply live over SSE (tight timeout
  // proves the live path, not the 30 s poll).
  await expect(bell).toContainText(/[1-9]/, { timeout: 5_000 })
  await bell.click()
  await expect(page.getByText('New thread reply')).toBeVisible()

  // Clicking the row deep-links to the reply: /chat/<cid>?msg=<replyId>.
  const reply = await db.message.findFirstOrThrow({ where: { conversationId: cid, parentId: { not: null } } })
  await page.getByText('New thread reply').click()
  await page.waitForURL(new RegExp(`/chat/${cid}\\?msg=${reply.id}$`))

  await pageB.context().close()
  await page.context().close()
})

// W4-A1 pinned messages: pin from the toolbar → the header "Pinned (n)" button
// appears live (msg_edit SSE) → the popover lists a preview → a row click
// deep-links ?msg= → Unpin from the popover removes the button (count 0).
test('10: pin a message → header popover → deep link → unpin', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  const cid = await createChannel(page, 'lab')
  await send(page, 'pin this for the crew')
  await expect(logMsg(page, 'pin this for the crew')).toBeVisible()

  // Toolbar Pin replaces the old disabled Bookmark placeholder (members only).
  await logMsg(page, 'pin this for the crew').hover()
  await page.getByTitle('Pin message').click()
  await expect(page.getByRole('button', { name: /Pinned \(1\)/ })).toBeVisible()

  // Open the popover: the row preview is visible; clicking it deep-links.
  await page.getByRole('button', { name: /Pinned \(1\)/ }).click()
  const popover = page.getByRole('dialog', { name: 'Pinned messages' })
  await expect(popover).toBeVisible()
  await expect(popover.getByText('pin this for the crew')).toBeVisible()
  const msg = await db.message.findFirstOrThrow({ where: { conversationId: cid, pinnedAt: { not: null } } })
  await popover.getByRole('button', { name: /pin this for the crew/ }).click()
  // router.push is a soft navigation (no full load event), so assert the URL by
  // polling rather than waitForURL's default waitUntil:'load'.
  await expect(page).toHaveURL(new RegExp(`/chat/${cid}\\?msg=${msg.id}$`))

  // Reopen and Unpin → the header button disappears entirely (count 0).
  await page.getByRole('button', { name: /Pinned \(1\)/ }).click()
  await page.getByRole('dialog', { name: 'Pinned messages' }).getByRole('button', { name: 'Unpin' }).click()
  await expect(page.getByRole('button', { name: /Pinned \(/ })).toHaveCount(0)

  await page.context().close()
})

// W4-A1 guest leg: no Pin affordance in the toolbar (or the ⋯ menu), but the
// header popover IS visible to guests — view-only, with no Unpin per row.
test('11: guests get no pin affordance but a view-only popover', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  const pageG = await joinAs(page, browser, GUEST, 'guest')
  await createChannel(page, 'lab')

  // Admin adds the guest via the Members… dialog (journey 4 idiom).
  await page.getByRole('button', { name: 'Conversation menu' }).click()
  await page.getByRole('button', { name: 'Members' }).click()
  await page.getByRole('button', { name: 'Gina Guest' }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Add/ }).click()
  // The Members dialog intentionally stays open after adding — close it so its
  // modal backdrop stops intercepting the later hover on the message row.
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
  await send(page, 'guest sees this')

  // The guest opens the channel (fresh navigation; membership already landed).
  await pageG.goto('/chat')
  const chan = pageG.getByRole('link', { name: 'lab' })
  await expect(chan).toBeVisible()
  await chan.click()
  await expect(pageG.getByRole('heading', { name: '#lab' })).toBeVisible()
  await expect(logMsg(pageG, 'guest sees this')).toBeVisible()

  // Admin pins; the guest's header count updates live via msg_edit SSE.
  await logMsg(page, 'guest sees this').hover()
  await page.getByTitle('Pin message').click()
  await expect(pageG.getByRole('button', { name: /Pinned \(1\)/ })).toBeVisible()

  // Guest toolbar: no Pin/Unpin button; ⋯ menu has no Pin item.
  await logMsg(pageG, 'guest sees this').hover()
  await expect(pageG.getByTitle('Pin message')).toHaveCount(0)
  await expect(pageG.getByTitle('Unpin message')).toHaveCount(0)
  await pageG.getByRole('button', { name: 'More actions' }).click()
  await expect(pageG.getByRole('menuitem', { name: 'Pin', exact: true })).toHaveCount(0)
  await expect(pageG.getByRole('menuitem', { name: 'Unpin', exact: true })).toHaveCount(0)
  await pageG.keyboard.press('Escape')

  // The popover opens for the guest — row visible, but no Unpin affordance.
  await pageG.getByRole('button', { name: /Pinned \(1\)/ }).click()
  const dlg = pageG.getByRole('dialog', { name: 'Pinned messages' })
  await expect(dlg).toBeVisible()
  await expect(dlg.getByText('guest sees this')).toBeVisible()
  await expect(dlg.getByRole('button', { name: 'Unpin' })).toHaveCount(0)

  await pageG.context().close()
  await page.context().close()
})

// W4-B composer auto-grow: typing real newlines (keyboard, not fill — each
// keystroke re-runs the growth effect) grows the textarea with its content up
// to COMPOSER_MAX_PX (200), then it scrolls internally (scrollHeight exceeds
// clientHeight) instead of pushing the message pane taller. The thread
// composer shares ComposerBody, so it inherits the behaviour for free.
test('12: composer auto-grows to a 200px cap, then scrolls internally', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  await createChannel(page, 'lab')

  const box = page.getByPlaceholder('Write a message…')
  await box.click()
  // Playwright 1.61's Locator is non-generic (its evaluate element param
  // defaults to SVGElement | HTMLElement, which lacks layout metrics), so each
  // callback below annotates HTMLElement explicitly to reach
  // offsetHeight/scrollHeight/clientHeight.
  const initial = await box.evaluate((el: HTMLElement) => el.offsetHeight)

  // Twelve lines via the keyboard; Shift+Enter inserts the newlines (bare
  // Enter would send).
  for (let i = 1; i <= 12; i++) {
    await page.keyboard.type(`line ${i}`)
    await page.keyboard.press('Shift+Enter')
  }

  // Grew past the one-line height, clamped at the cap…
  await expect.poll(() => box.evaluate((el: HTMLElement) => el.offsetHeight)).toBeGreaterThan(initial)
  const metrics = await box.evaluate((el: HTMLElement) => ({ offsetHeight: el.offsetHeight, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }))
  expect(metrics.offsetHeight).toBeLessThanOrEqual(200)
  // …and at the cap the overflow scrolls INSIDE the textarea.
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)

  await page.context().close()
})

// Wave-5 regression: on grouped rows (2nd+ message from the same author within
// 5 min) the hover-only gutter clock used to render in-flow inside the 36px
// column-1 track, where "9:14 AM" wrapped to two lines (44px vs a ~24px row) —
// so hovering grew the row and shoved every message below down. The clock is
// now absolute over the gutter + nowrap, so revealing it must not change the
// row's height at all.
test('13: grouped-row hover clock reveals without shifting layout', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  await createChannel(page, 'lab')

  // Two quick messages from the same author → the second row renders grouped.
  // Wait for each REAL row (optimistic temps carry tmp-* ids) between sends:
  // the composer guards Enter while a send is in-flight and clears the draft
  // on 201, so a back-to-back fill+Enter races the first POST and is dropped.
  const realRow = (text: string) => page.locator('[data-msg-id]:not([data-msg-id^="tmp-"])', { hasText: text })
  await send(page, 'first of the pair')
  await expect(realRow('first of the pair')).toBeVisible()
  await send(page, 'second of the pair')
  await expect(realRow('second of the pair')).toBeVisible()
  const row = realRow('second of the pair')

  // Playwright 1.61's Locator is non-generic — annotate the evaluate element
  // param as HTMLElement to reach offsetHeight (test 12's convention).
  const before = await row.evaluate((el: HTMLElement) => el.offsetHeight)

  await row.hover()
  // The grouped clock (the aria-hidden <time>) really did reveal on hover…
  await expect(row.locator('time[aria-hidden]')).toBeVisible()
  // …and the reveal left the row's height strictly unchanged.
  const after = await row.evaluate((el: HTMLElement) => el.offsetHeight)
  expect(after).toBe(before)

  await page.context().close()
})

// Wave-6: unread-chats "(N)" TAB TITLE. ChatTitleBadge is mounted in the app
// shell, so it bells from ANY page — here A parks on the dashboard while B
// messages a channel A hasn't opened. The count uses the SAME derivation as the
// sidebar Chat badge (sumUnread over the live store), so opening the channel
// (markRead) clears the tab title exactly when it clears the badge.
test('14: unread messages bell the tab title "(N)"; opening the channel restores it', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  const pageB = await joinAs(page, browser, BOB, 'member')
  const cid = await createChannel(page, 'lab')
  await joinChannel(pageB, cid, 'lab')

  // A parks AWAY from the channel; capture the base title BEFORE any unread
  // exists (the badge prefixes onto this exact string when restoring).
  await page.goto('/dashboard')
  const base = await page.evaluate(() => document.title)
  expect(base).not.toMatch(/^\(\d+\)\s/) // sanity: no stale prefix at the start

  // B sends; A's live store updates over SSE → the tab title gains "(1)".
  await send(pageB, 'title ping')
  await expect
    .poll(() => page.evaluate(() => document.title), { timeout: 10_000 })
    .toMatch(/^\(1\)\s/)

  // A opens the channel → markRead clears the unread → title restored to base.
  await page.goto('/chat/' + cid)
  await expect(logMsg(page, 'title ping')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.title), { timeout: 10_000 })
    .toBe(base)

  await pageB.context().close()
  await page.context().close()
})

// Wave-7 (feedback cmt0zfclu / cmt0zijpf): paste-anywhere images + the image
// lightbox + the Chrome picker zip MIME. Paste, like the F1 drag above, cannot
// be synthesized as a real OS clipboard action — build the DataTransfer in page
// context and dispatch a ClipboardEvent. On the composer textarea it exercises
// the composer's own onPaste; on a message ROW it exercises the pane-level
// forwarding added in wave-7 (focus lives on the row via the roving tabIndex,
// and the event bubbles to [data-chat-pane]).
const PNG_BODY = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

function dispatchPaste(page: Page, target: 'textarea' | 'row', file: { name: string; type: string; body: Buffer }) {
  return page.evaluate(({ target, file }) => {
    const dt = new DataTransfer()
    const bytes = Uint8Array.from(atob(file.body), (c) => c.charCodeAt(0))
    dt.items.add(new File([bytes], file.name, { type: file.type }))
    const el = target === 'textarea'
      ? document.querySelector('textarea[aria-label="Write a message"]')!
      : document.querySelector('[data-msg-id]')!
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
  }, { target, file: { name: file.name, type: file.type, body: file.body.toString('base64') } })
}

test('15: paste an image into the composer, send, then view it full-size in the lightbox', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  await createChannel(page, 'lab')

  // Paste lands in the shared validated intake: a pending chip with the filename.
  await page.getByPlaceholder('Write a message…').click()
  await dispatchPaste(page, 'textarea', { name: 'pasted-figure.png', type: 'image/png', body: PNG_BODY })
  await expect(page.getByText('pasted-figure.png')).toBeVisible()

  // Send and let the optimistic temp settle into the real message row before
  // clicking (the remount leg below exercises the racy window deliberately).
  await send(page, 'figure from the clipboard')
  await expect(page.locator('[data-msg-id]:not([data-msg-id^="tmp-"])', { hasText: 'figure from the clipboard' })).toBeVisible()
  const viewBtn = page.getByRole('button', { name: 'View image: pasted-figure.png' })
  await expect(viewBtn).toBeVisible()

  // Click → the lightbox dialog opens with the image at full size.
  await viewBtn.click()
  const dialog = page.getByRole('dialog', { name: 'pasted-figure.png' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('img', { name: 'pasted-figure.png' })).toBeVisible()

  // Escape closes it and focus returns to the trigger (useFocusTrap restore).
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(viewBtn).toBeFocused()

  await page.context().close()
})

// Wave-7 regression: the viewer lives in an EXTERNAL store (image-viewer-store)
// precisely because the timeline row REMOUNTS when the optimistic temp
// (data-msg-id="tmp-…") is replaced by the server message — a per-row lightbox
// closed itself the instant the real row landed. Hold the POST response until
// after the dialog opens to make that window deterministic.
test('16: the lightbox survives the optimistic-temp row being replaced mid-view', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  await createChannel(page, 'lab')

  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  await page.route('**/api/chat/messages', async (route) => {
    if (route.request().method() === 'POST') { await held; }
    await route.continue()
  })

  await page.getByPlaceholder('Write a message…').click()
  await dispatchPaste(page, 'textarea', { name: 'temp-figure.png', type: 'image/png', body: PNG_BODY })
  await expect(page.getByText('temp-figure.png')).toBeVisible()

  // Send: the temp row (with its image) renders while the POST is held.
  await send(page, 'race window open')
  const tempBtn = page.getByRole('button', { name: 'View image: temp-figure.png' })
  await expect(tempBtn).toBeVisible()
  await expect(page.locator('[data-msg-id^="tmp-"]')).toHaveCount(1)

  // Open the viewer ON the temp row, then let the real message replace it.
  await tempBtn.click()
  const dialog = page.getByRole('dialog', { name: 'temp-figure.png' })
  await expect(dialog).toBeVisible()
  release()
  await expect(page.locator('[data-msg-id]:not([data-msg-id^="tmp-"])', { hasText: 'race window open' })).toBeVisible()

  // The dialog is STILL open — the store outlived the row remount.
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  await page.context().close()
})

test('17: pasting with focus on a message row attaches via the pane (Slack-style)', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  await createChannel(page, 'lab')

  // One message in the log; click its row to park focus there (roving tabIndex).
  await send(page, 'focus lands on this row')
  await expect(logMsg(page, 'focus lands on this row')).toBeVisible()
  await page.locator('[data-msg-id]').first().click()

  // A clipboard paste with FILES on the row bubbles to the pane handler, which
  // forwards it into the composer intake — no textarea focus required.
  await dispatchPaste(page, 'row', { name: 'row-paste.png', type: 'image/png', body: PNG_BODY })
  await expect(page.getByText('row-paste.png')).toBeVisible()

  await page.context().close()
})

test('18: attach a zip with the Chrome picker MIME (application/x-zip-compressed)', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  await createChannel(page, 'lab')

  // Chromium's file picker types .zip as application/x-zip-compressed — the
  // wave-7 bug: both gates rejected it, so Chrome users could not attach zips.
  const ZIP = Buffer.from('PK\x03\x04wave-7-zip-payload')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'dataset.zip', mimeType: 'application/x-zip-compressed', buffer: ZIP })
  await expect(page.getByText('dataset.zip')).toBeVisible()

  // Send: the timeline renders the download chip (non-image attachment).
  await send(page, 'zip inbound')
  await expect(page.getByRole('link', { name: /dataset\.zip/ })).toBeVisible()

  await page.context().close()
})

// Wave-7.1 (paste degrade): the normal clipboard write populates .files, but a
// real macOS screenshot paste can arrive with .files EMPTY while the image
// rides items or an html data-URL. A real DataTransfer with only text/html set
// is the closest synthesizable analog (its .files stays empty), so this pins
// the extractor's html leg end-to-end — and proves an image paste never
// degrades to junk filename text in the textarea (the reported symptom).
test('19: paste an image copied from a web page (html data-URL flavor) — attaches, never junk text', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  await createChannel(page, 'lab')

  const box = page.getByPlaceholder('Write a message…')
  await box.click()
  await page.evaluate((b64) => {
    const dt = new DataTransfer()
    dt.setData('text/html', `<img src="data:image/png;base64,${b64}" alt="copied figure">`)
    document.querySelector('textarea[aria-label="Write a message"]')!.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
  }, PNG_BODY.toString('base64'))

  // The decoded image joins the intake: a pending chip, and the textarea stays
  // EMPTY — no literal "image.png"/filename text (the wave-7.1 bug).
  await expect(page.getByText('pasted-image.png')).toBeVisible()
  await expect(box).toHaveValue('')

  // Send: the timeline shows the view-image affordance like any image paste.
  await send(page, 'figure from the web')
  await expect(page.getByRole('button', { name: 'View image: pasted-image.png' })).toBeVisible()

  await page.context().close()
})

// Wave-7.2 (unreproducible degrade): every synthesizable clipboard shape
// attaches via the paste event, yet a real-world paste still degraded to the
// literal "image.png" text. The escalation: a paste that yields NO file but
// CLAIMS a Files flavor or carries ONLY synthesized-filename text is killed
// (the default insert IS that junk) and escalated to a direct clipboard.read().
// This pins the filename-only shape: no junk text lands, and the fallback error
// shows (headless Chromium denies clipboard-read → deterministic error branch).
test('20: filename-only paste never types junk; escalates and surfaces feedback', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await admin(browser)
  await createChannel(page, 'lab')

  const box = page.getByPlaceholder('Write a message…')
  await box.click()
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.setData('text/plain', 'image.png')
    document.querySelector('textarea[aria-label="Write a message"]')!.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
  })

  // The junk insert is dead: the textarea stays empty…
  await expect(box).toHaveValue('')
  // …and the escalation resolved to the honest fallback (clipboard-read is
  // unavailable in this context), shown inline in the composer.
  await expect(page.getByText(/Couldn't read the image from your clipboard/)).toBeVisible()

  // A NORMAL text paste is still untouched: no escalation fires. NB a
  // synthetic (untrusted) paste performs no default insert, so the proof is
  // behavioral — the already-shown error is neither duplicated nor replaced,
  // and no attachment chip appears. NB the error from leg 1 stays (inline
  // errors clear on the next attach/send, not on plain pastes) — count stays 1.
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.setData('text/plain', 'image.png is attached, see below')
    document.querySelector('textarea[aria-label="Write a message"]')!.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
  })
  await page.waitForTimeout(300)
  await expect(page.getByText(/Couldn't read the image from your clipboard/)).toHaveCount(1)

  await page.context().close()
})
