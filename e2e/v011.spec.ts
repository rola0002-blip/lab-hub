import { randomUUID } from 'node:crypto'
import { test, expect, type Browser, type Page } from '@playwright/test'
import { wipe, seedSystem, runWizard, signIn, ADMIN, createIssueViaUI, createMemberViaInvite, acceptInvite, db } from './helpers'
import { COLOSSUS_BOT_ID, LAB_UPDATES_CHANNEL_ID } from '@/features/bot/ids'

// v0.11 UX wave: the live sidebar unread badge, issue deletion, back navigation, and the
// issue detail's Project link. The sp8.spec.ts posture — serial, per-context client IP so
// better-auth's per-IP sign-in limit never trips, one beforeAll wipe + seedSystem(), and
// the wizard + sign-in run once (test 1) with the later tests only signing in.
//
// Band 10.70.x is unused by the other suites (10.10 / 10.20 / 10.30 / 10.40 / 10.41 /
// 10.50 / 10.60 are taken), so this file's sign-ins stay out of every other bucket.
let ipSeq = 0
async function newPage(browser: Browser): Promise<Page> {
  ipSeq += 1
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `10.70.${ipSeq}.7` } })
  return ctx.newPage()
}

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => { await wipe(); await seedSystem() })

const GUEST_PASS = 'GuestPass!1234'

// Next's dev SSR leaves a HIDDEN duplicate of the streamed tree in `div#S:0` at body
// level, so CSS/text locators (unlike role locators, which skip the a11y-hidden copy)
// resolve twice under strict mode. Anything not role-based here is rooted at <main> or
// inside a role locator, which only the real tree is inside.
const main = (page: Page) => page.getByRole('main')
// The visible message list; the sr-only live announcer is ALSO a role="log".
const log = (page: Page) => page.getByRole('log', { name: 'Messages' })
// The sidebar Chat badge is the count chip inside the Chat nav link (ui/badge.tsx:12).
const chatBadge = (page: Page) => page.getByRole('link', { name: /^Chat/ }).locator('span.rounded-full')
// The issue detail's <aside aria-label="Properties"> — scopes the project-row assertions
// away from the page's other links and buttons.
const props = (page: Page) => page.getByRole('complementary', { name: 'Properties' })
// `exact: true`: accessible-name matching is a case-insensitive SUBSTRING match, and
// the v0.13 sidebar footer button "Give feedback" contains "back" — without this the
// toHaveCount(0) assertions below would see the footer button and the toBeVisible()
// ones would be strict-mode ambiguous. The top-bar control's name is exactly "Back".
const backBtn = (page: Page) => page.getByRole('button', { name: 'Back', exact: true })

// The depth STAMPED ON THE CURRENT HISTORY ENTRY (src/lib/history-depth.ts). Visibility
// alone would pass against a bare counter; the stamp is the actual invariant.
function depthOf(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const s = window.history.state as Record<string, unknown> | null
    return s && typeof s.labhubDepth === 'number' ? s.labhubDepth : null
  })
}
// Polled, because the load entry is stamped by BackButton's mount effect: read once,
// immediately after a `goto`, and the answer is `null` simply because hydration has not
// happened yet. An entry that is genuinely never stamped still fails, on the timeout.
async function expectDepth(page: Page, depth: number): Promise<void> {
  await expect.poll(() => depthOf(page), { timeout: 10_000 }).toBe(depth)
}

const identifierOf = (page: Page) => new URL(page.url()).pathname.split('/').pop() as string

async function adminId(): Promise<string> {
  return (await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })).id
}

// ─────────────────────────────────────────────────────────────────────────────
test('1: the sidebar Chat badge is live — a peer post lights it, reading clears it with no reload, and my own announce never bumps it', async ({ browser }) => {
  test.setTimeout(150_000)
  const page = await newPage(browser)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  const me = await adminId()

  // A peer posts into #lab-updates while the admin sits elsewhere. The admin was
  // auto-joined at sign-up (the better-auth after-hook) and ConversationMember.lastReadAt
  // defaults to now(), so a message written AFTER that join is genuinely unread.
  // `User.id` carries no @default (schema.prisma:11), so a direct insert mints one.
  const peer = await db.user.create({
    data: { id: randomUUID(), name: 'Peer', email: 'peer@lab.test', emailVerified: true, role: 'member' },
  })
  await db.conversationMember.create({ data: { conversationId: LAB_UPDATES_CHANNEL_ID, userId: peer.id } })
  await db.message.create({ data: { conversationId: LAB_UPDATES_CHANNEL_ID, userId: peer.id, body: 'Furnace is down until Thursday' } })

  await page.goto('/dashboard')
  await expect(chatBadge(page)).toHaveText('1')

  // Everything below is CLIENT-SIDE navigation. The sentinel proves it: a document reload
  // drops it — and a reload would re-run the SSR seed, which is the one path this test
  // must not be able to pass through. The badge has to clear from the live chat store.
  await page.evaluate(() => { (window as unknown as { __noReload?: true }).__noReload = true })

  await page.getByRole('link', { name: /^Chat/ }).click()
  await page.waitForURL('**/chat')
  await page.getByRole('link', { name: /lab-updates/ }).click()
  await page.waitForURL('**/chat/' + LAB_UPDATES_CHANNEL_ID)
  await expect(log(page).getByText('Furnace is down until Thursday')).toBeVisible()
  await expect(chatBadge(page)).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __noReload?: true }).__noReload)).toBe(true)

  // Own-action exclusion: filing an issue makes the BOT post to #lab-updates, and every
  // unread predicate excludes only the READER's own messages — so without
  // announceToChannel's actor thread the actor's own badge would tick. Wait until the
  // announce exists AND the actor's cursor has been advanced past it, so the assertion
  // lands at exactly the moment a broken exclusion would be showing a 1.
  await page.getByRole('link', { name: 'Issues', exact: true }).click()
  await page.waitForURL('**/issues')
  await createIssueViaUI(page, 'Own-action badge guard')
  await expect(async () => {
    const announce = await db.message.findFirstOrThrow({
      where: { conversationId: LAB_UPDATES_CHANNEL_ID, userId: COLOSSUS_BOT_ID }, orderBy: { createdAt: 'desc' },
    })
    const mem = await db.conversationMember.findUniqueOrThrow({
      where: { conversationId_userId: { conversationId: LAB_UPDATES_CHANNEL_ID, userId: me } },
    })
    expect(mem.lastReadAt.getTime()).toBeGreaterThanOrEqual(announce.createdAt.getTime())
  }).toPass({ timeout: 20_000 })
  await expect(chatBadge(page)).toHaveCount(0)                    // live value, still no reload
  expect(await page.evaluate(() => (window as unknown as { __noReload?: true }).__noReload)).toBe(true)
  await page.goto('/dashboard')                                   // and the SSR seed agrees
  await expect(chatBadge(page)).toHaveCount(0)
  await page.context().close()
})

// ─────────────────────────────────────────────────────────────────────────────
test('2: an issue is deleted from the ⋯ menu — the route 404s, its chat pill degrades to plain text, and Back never restores it', async ({ browser }) => {
  test.setTimeout(150_000)
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)

  await page.goto('/issues')
  await createIssueViaUI(page, 'Delete me please')
  const identifier = identifierOf(page)

  // While the issue exists the #lab-updates creation line renders a LINKED pill
  // (`New issue LAB-n: …`, resolved client-side by IssueRefProvider).
  await page.goto(`/chat/${LAB_UPDATES_CHANNEL_ID}`)
  await expect(page.getByRole('link', { name: new RegExp(`${identifier}\\s*Delete me please`) })).toBeVisible()

  // Two in-app entries behind the detail page, so the post-delete history assertions can
  // tell "the issue's entry was REPLACED" from "/issues was PUSHED on top of it".
  await page.goto('/projects')                                       // entry A (cold load)
  await page.getByRole('link', { name: 'Issues', exact: true }).click()
  await page.waitForURL('**/issues')                                 // entry B
  await main(page).getByRole('link', { name: new RegExp(`${identifier}\\s*Delete me please`) }).click()
  await page.waitForURL(`**/issues/${identifier}`)                   // entry C

  await page.getByRole('button', { name: 'Issue actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete issue' }).click()
  // The menu item and the confirm button share the name "Delete issue" — scope the
  // confirm to the dialog or the click is ambiguous.
  const dialog = page.getByRole('dialog', { name: 'Delete issue?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(`${identifier} Delete me please`)).toBeVisible()   // names what goes
  await expect(dialog.getByText('This cannot be undone.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete issue' }).click()

  await page.waitForURL('**/issues')
  await expect(main(page).getByText('Delete me please')).toHaveCount(0)

  // router.replace, not push: the detail entry is GONE, so the first Back lands on the
  // /issues entry behind it (never the deleted page's cached RSC payload) and the second
  // reaches /projects — two backs, not three.
  await page.goBack()
  await expect(page).toHaveURL(/\/issues$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/projects$/)

  // The identifier is never reissued (issue_number_seq has no setval), so the old link is
  // a clean 404 and never a different issue.
  const res = await page.goto(`/issues/${identifier}`)
  expect(res?.status()).toBe(404)

  // The historical announce survives; its pill degrades to plain text, not a broken link.
  await page.goto(`/chat/${LAB_UPDATES_CHANNEL_ID}`)
  await expect(log(page).getByText(`New issue ${identifier}: Delete me please`)).toBeVisible()
  await expect(page.getByRole('link', { name: new RegExp(identifier) })).toHaveCount(0)
  await page.context().close()
})

// ─────────────────────────────────────────────────────────────────────────────
test('3: the back control follows the depth stamped on history — absent cold, present after a push, replace-proof, hotkeyed, dialog-inert', async ({ browser }) => {
  test.setTimeout(180_000)
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)

  // COLD LOAD of a route we are NOT already on. A same-URL goto is a reload, which reuses
  // the entry and the stamp already on it — that is the reload case, not the cold case.
  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(backBtn(page)).toHaveCount(0)
  await expectDepth(page, 0)

  // One in-app navigation: a real pushState, one entry deeper.
  await page.getByRole('link', { name: 'Issues', exact: true }).click()
  await page.waitForURL('**/issues')
  await expect(backBtn(page)).toBeVisible()
  await expectDepth(page, 1)

  // A QUERY-ONLY navigation is router.replace (filter-bar.tsx:20): the entry is
  // overwritten rather than created, and Next writes a BARE state that strips the stamp.
  // The depth must survive that, or the control blinks out on every filter change.
  await page.getByRole('combobox', { name: 'Status' }).selectOption('TODO')
  await expect(page).toHaveURL(/status=TODO/)
  await expect(backBtn(page)).toBeVisible()
  await expectDepth(page, 1)

  // Click returns to /projects, whose entry is stamped 0 — so the control hides itself
  // rather than offering a Back that would leave the app.
  await backBtn(page).click()
  await page.waitForURL('**/projects')
  await expect(backBtn(page)).toHaveCount(0)
  await expectDepth(page, 0)

  // Forward again, then ⌘[ / Ctrl+[ instead of the click.
  await page.getByRole('link', { name: 'Issues', exact: true }).click()
  await page.waitForURL('**/issues')
  await expect(backBtn(page)).toBeVisible()
  await page.keyboard.press('ControlOrMeta+[')
  await page.waitForURL('**/projects')
  await expect(backBtn(page)).toHaveCount(0)

  // An open modal makes the hotkey inert (the [role=dialog][aria-modal=true] guard), so
  // ⌘[ inside a dialog can never navigate the page out from under it.
  await page.getByRole('link', { name: 'Issues', exact: true }).click()
  await page.waitForURL('**/issues')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+k')
    await expect(palette).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10_000 })
  await page.keyboard.press('ControlOrMeta+[')
  await expect(page).toHaveURL(/\/issues$/)
  await expect(palette).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(palette).toHaveCount(0)

  // COLD DEEP LINK → delete → replace. The deep link is depth 0 (a notification link or a
  // PWA launch), and router.replace must not deepen it: the control stays absent, so Back
  // still cannot walk out of the app from the page the delete landed on.
  await createIssueViaUI(page, 'Cold deep-link delete')
  const identifier = identifierOf(page)
  await page.goto('/dashboard')                     // a DIFFERENT url, so the next goto is
  await page.goto(`/issues/${identifier}`)          // a genuine cold load of the detail page
  await expect(backBtn(page)).toHaveCount(0)
  await expectDepth(page, 0)
  await page.getByRole('button', { name: 'Issue actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete issue' }).click()
  await page.getByRole('dialog', { name: 'Delete issue?' }).getByRole('button', { name: 'Delete issue' }).click()
  await page.waitForURL('**/issues')
  await expect(backBtn(page)).toHaveCount(0)
  await expectDepth(page, 0)
  await page.context().close()
})

// ─────────────────────────────────────────────────────────────────────────────
test('4: the issue Project property is a link plus a separately-named Set project control, in all four role × state shapes', async ({ browser }) => {
  test.setTimeout(180_000)
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)

  await page.goto('/projects')
  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByLabel('Name').fill('Back-nav project')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/projects\/[^/]+$/)
  const projectId = identifierOf(page)

  // Filed FROM the project page, so the composer pre-fills the project
  // (project-header.tsx:69).
  await createIssueViaUI(page, 'Linked to a project')
  const linked = identifierOf(page)

  // SHAPE 1 — project set, editor: an accent LINK to the project it names, plus a
  // SEPARATE, separately-named "Set project" control. Two controls, two names.
  const projectLink = props(page).getByRole('link', { name: 'Back-nav project' })
  await expect(projectLink).toHaveAttribute('href', `/projects/${projectId}`)
  await expect(props(page).getByRole('button', { name: 'Set project' })).toBeVisible()
  await projectLink.click()
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`))

  // SHAPE 3 — no project, editor: ONE full-size trigger carrying the row's own text. The
  // likeliest action on the row keeps its hit area; it is deliberately NOT a bare chevron.
  await page.goto('/issues')
  await createIssueViaUI(page, 'No project at all')
  const unlinked = identifierOf(page)
  const trigger = props(page).getByRole('button', { name: 'Set project' })
  await expect(trigger).toBeVisible()
  await expect(trigger).toHaveText('No project')
  await expect(props(page).getByRole('link')).toHaveCount(0)

  // SHAPES 2 + 4 — a guest reads the link in both states and gets no control in either.
  const token = await createMemberViaInvite(page, 'guest@lab.test', 'guest')
  const gp = await newPage(browser)
  await acceptInvite(gp, token, 'Guesty', GUEST_PASS)

  await gp.goto(`/issues/${linked}`)
  await expect(props(gp).getByRole('link', { name: 'Back-nav project' })).toHaveAttribute('href', `/projects/${projectId}`)
  await expect(props(gp).getByRole('button', { name: 'Set project' })).toHaveCount(0)

  await gp.goto(`/issues/${unlinked}`)
  await expect(props(gp).getByText('No project')).toBeVisible()
  await expect(props(gp).getByRole('button', { name: 'Set project' })).toHaveCount(0)
  await expect(props(gp).getByRole('link')).toHaveCount(0)
  await gp.context().close()
  await page.context().close()
})
