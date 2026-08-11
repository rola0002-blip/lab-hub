import { test, expect, type Browser, type Page } from '@playwright/test'
import { wipe, seedSystem, runWizard, signIn, ADMIN, createMemberViaInvite, acceptInvite, db } from './helpers'
import { LAB_UPDATES_CHANNEL_ID } from '@/features/bot/ids'

// SP8 "progress loop" journeys: weekly project updates + health chips, capture-from-chat,
// the worst-first review screen, the stalled signal, and the "Lab today" dashboard.
//
// Per-context client IP so better-auth's per-IP sign-in/up rate limit never trips
// (the files/sp5/sp7 posture). Band 10.60.x is unused by the other suites, so this
// file's sign-ins stay out of every other bucket.
let ipSeq = 0
async function newPage(browser: Browser): Promise<Page> {
  ipSeq += 1
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `10.60.${ipSeq}.7` } })
  return ctx.newPage()
}

// Serial + ONE-TIME wipe/seed: test 1 provisions the org + admin AND creates the project
// the later tests reuse (workers:1 → one shared database). seedSystem reinstalls the bot
// and #lab-updates that wipe() truncated.
test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => { await wipe(); await seedSystem() })

const PASS = 'MemberPass!1234'
const BOB = { email: 'bob@lab.test', name: 'Bob Member' }
const PROJECT = 'Graphene growth'
// Markdown, not decoration: `**` and a `- ` list line are what v0.14.1's rendering
// parity is asserted on when test 1 lands on the project page.
const PROJECT_DESC = 'Monolayer on **Cu/Ni foils**.\n- transfer yield ≥ 90%'
const UPDATE_BODY = 'Films came out polycrystalline — switching to Cu/Ni. See LAB-1'

// Filled by test 1, reused by tests 2 and 5.
let projectId = ''
// Filled by test 3 (the off-track fixture), reused by test 5's guest posture check.
let offTrackProjectId = ''

// The visible message list is role="log" aria-label="Messages"; the sr-only live
// announcer is ALSO a role="log", so chat-body assertions are scoped to the visible
// list (the messaging.spec.ts contract).
const log = (page: Page) => page.getByRole('log', { name: 'Messages' })

// Next's dev SSR leaves a HIDDEN duplicate of the streamed tree in `div#S:0` at body
// level, so CSS/text locators (unlike role locators, which skip the a11y-hidden copy)
// resolve twice under strict mode and any count doubles. Every such locator in this
// file is rooted at <main>, which only the real tree is inside.
const main = (page: Page) => page.getByRole('main')

// Admin creates a public channel via the sidebar "+" dialog, ending inside it.
async function createChannel(page: Page, name: string): Promise<string> {
  await page.goto('/chat')
  await page.getByRole('button', { name: 'Browse or create channels' }).click()
  await page.getByRole('button', { name: 'New channel' }).click()
  await page.getByPlaceholder('e.g. cvd-lab').fill(name)
  await page.getByRole('button', { name: 'Create channel', exact: true }).click()
  await page.waitForURL(/\/chat\/[^/]+$/)
  await expect(page.getByRole('heading', { name: '#' + name })).toBeVisible()
  return new URL(page.url()).pathname.split('/').pop()!
}

async function adminId(): Promise<string> {
  return (await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })).id
}

// ─────────────────────────────────────────────────────────────────────────────
test('1: post a project update from the project page; it announces in #lab-updates', async ({ browser }) => {
  test.setTimeout(120_000)
  const page = await newPage(browser)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)

  await page.goto('/projects')
  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByLabel('Name').fill(PROJECT)
  await page.getByLabel('Description').fill(PROJECT_DESC)
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/projects\/[^/]+$/)
  projectId = new URL(page.url()).pathname.split('/').pop()!
  await expect(page.getByRole('heading', { name: PROJECT })).toBeVisible()

  // v0.14.1 — the SP4 spec declares `description (markdown)`, and every peer long-form
  // field (chat bodies, issue descriptions, update bodies) already renders through the
  // shared tokenizer; the project description alone printed its source. Assert the
  // rendered marks, and that the syntax itself never reaches the page as literal text.
  await expect(main(page).locator('strong', { hasText: 'Cu/Ni foils' })).toBeVisible()
  await expect(main(page).getByText('• transfer yield ≥ 90%')).toBeVisible()
  await expect(main(page).getByText('**')).toHaveCount(0)

  // THREE controls on this page are named "Post update" — the header button, the
  // Updates-section button, and (once open) the modal's submit. The Updates section
  // carries no aria-labelledby, so getByRole('region') cannot disambiguate: take the
  // header button with .first() and scope the submit to the dialog.
  await page.getByRole('button', { name: 'Post update' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Post project update' })
  await expect(dialog).toBeVisible()

  // The health radios are sr-only inputs inside a visible <label> that carries the
  // chip, the focus ring and the accessible name — click the label, assert the input.
  await dialog.getByText('At risk', { exact: true }).click()
  await expect(dialog.getByRole('radio', { name: 'At risk' })).toBeChecked()
  await dialog.getByRole('textbox', { name: 'Update' }).fill(UPDATE_BODY)
  await dialog.getByRole('button', { name: 'Post update' }).click()
  await expect(dialog).toBeHidden()

  // The composer pushes back to the project and refreshes the server render, so the
  // new card is on the page it lands on.
  await expect(main(page).getByText('Films came out polycrystalline')).toBeVisible()
  // Health word, never colour-alone — the header chip and the update row agree, so
  // the word appears exactly twice on the detail page.
  await expect(main(page).getByText('At risk', { exact: true })).toHaveCount(2)

  // The bot announced it in #lab-updates (the admin auto-joined at wizard sign-up).
  await page.goto('/chat')
  await page.getByRole('link', { name: /lab-updates/ }).click()
  await expect(log(page).getByText(/posted an update on/).first()).toBeVisible()
})

// ─────────────────────────────────────────────────────────────────────────────
test('2: "Post as project update" captures a chat message and backlinks to it', async ({ browser }) => {
  test.setTimeout(120_000)
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  const cid = await createChannel(page, 'growth')

  const box = page.getByPlaceholder('Write a message…')
  await box.fill('Growth 14 looks textured')
  await box.press('Enter')
  const posted = log(page).getByText('Growth 14 looks textured')
  await expect(posted).toBeVisible()

  await posted.hover()
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Post as project update' }).click()

  const dialog = page.getByRole('dialog', { name: 'Post project update' })
  await expect(dialog).toBeVisible()
  // Prefill = the quoted body + author attribution (the create-issue capture idiom).
  await expect(dialog.getByRole('textbox', { name: 'Update' })).toHaveValue(/^> Growth 14 looks textured/)
  await dialog.getByRole('combobox', { name: 'Project' }).selectOption({ label: PROJECT })
  await expect(dialog.getByRole('radio', { name: 'On track' })).toBeChecked() // composer default
  await dialog.getByRole('button', { name: 'Post update' }).click()

  await page.waitForURL(`**/projects/${projectId}`)
  // The origin chip renders for everyone who could see the source, but only LINKS
  // back for current members of that conversation — the admin is the author, so it links.
  const chip = page.getByRole('link', { name: /From a message in #growth/ })
  await expect(chip).toBeVisible()
  await expect(chip).toHaveAttribute('href', new RegExp(`^/chat/${cid}\\?msg=`))
})

// ─────────────────────────────────────────────────────────────────────────────
test('3: /projects renders the manual arrangement and its filters round-trip through the URL', async ({ browser }) => {
  test.setTimeout(120_000)
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  const me = await adminId()

  // v0.12: the grid is the lab's MANUAL arrangement, so the seeded `rank` literals
  // ('B' < 'C' < 'D' < 'E' byte-wise, matching COLLATE "C") ARE the expected DOM
  // order. The names are not in that alphabetical order and the health buckets do
  // not agree with it either — Papa films carries a fresh OFF_TRACK update yet
  // sorts LAST — so neither a name sort nor the old worst-first sort could pass.
  // All four carry a lead, so the no_lead bucket cannot swallow them.
  const off = await db.project.create({ data: { name: 'Zulu films', leadId: me, rank: 'B' } })
  offTrackProjectId = off.id
  await db.projectUpdate.create({ data: { projectId: off.id, authorId: me, health: 'OFF_TRACK', body: 'Chamber leak; growths halted.' } })
  await db.project.create({ data: { name: 'Mike films', leadId: me, rank: 'C' } }) // no updates ever → "No update"
  const on = await db.project.create({ data: { name: 'Alpha films', leadId: me, rank: 'D' } })
  await db.projectUpdate.create({ data: { projectId: on.id, authorId: me, health: 'ON_TRACK', body: 'Two clean transfers this week.' } })
  // PAUSED + a fresh OFF_TRACK update: sits in the review list, but the attention
  // predicate is ACTIVE-only, so it must never surface under ?attention=1.
  const paused = await db.project.create({ data: { name: 'Papa films', leadId: me, status: 'PAUSED', rank: 'E' } })
  await db.projectUpdate.create({ data: { projectId: paused.id, authorId: me, health: 'OFF_TRACK', body: 'Parked until the new furnace lands.' } })

  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'Zulu films' })).toBeVisible()
  // Card titles in DOM order. v0.12 moved the link off the card root onto the name,
  // so the title is `h2 > a[href^="/projects/"]` (the old `a … h2` matches nothing).
  // Compare INDICES only, so projects seeded by the earlier tests (which mint their
  // rank at the FRONT) can interleave without breaking the ordering contract.
  const order = await main(page).locator('h2 a[href^="/projects/"]').allTextContents()
  expect(order.indexOf('Zulu films')).toBeLessThan(order.indexOf('Mike films'))   // rank B before C
  expect(order.indexOf('Mike films')).toBeLessThan(order.indexOf('Alpha films'))  // rank C before D
  expect(order.indexOf('Alpha films')).toBeLessThan(order.indexOf('Papa films'))  // rank D before E
  // Unfiltered, the arrangement is live: every card carries its grip.
  expect(await page.getByRole('button', { name: /^Reorder / }).count()).toBeGreaterThan(0)

  // Health filter round-trips through the URL and narrows the list.
  await page.getByRole('combobox', { name: 'Health' }).selectOption('off_track')
  await expect(page).toHaveURL(/health=off_track/)
  await expect(page.getByRole('heading', { name: 'Zulu films' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Mike films' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Alpha films' })).toHaveCount(0)
  // A filtered view is not the arrangement, so dropping into it would be a lie:
  // the grip disappears entirely (canArrange is false → no DndContext at all).
  await expect(page.getByRole('button', { name: /^Reorder / })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Move / })).toHaveCount(0)

  // Unknown values degrade to "no filter" (parseProjectFilters), never a Prisma enum.
  await page.goto('/projects?health=bogus')
  await expect(page.getByRole('heading', { name: 'Zulu films' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Mike films' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Alpha films' })).toBeVisible()

  // ?attention=1 is ACTIVE-only: the PAUSED project keeps its fresh OFF_TRACK update
  // and still must not appear (the predicate lives inline on the page).
  await page.goto('/projects?attention=1')
  await expect(page.getByRole('heading', { name: 'Zulu films' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Papa films' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Alpha films' })).toHaveCount(0) // on_track is never "attention"
})

// ─────────────────────────────────────────────────────────────────────────────
test('4: the stalled chip renders on started, untouched issues and its filter composes', async ({ browser }) => {
  test.setTimeout(120_000)
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  const me = await adminId()

  // "Touched" is max(activity, non-deleted comment) — NEVER Issue.updatedAt, which
  // Prisma bumps on every write. Both rows are created now, so only the BACK-DATED
  // activity can produce a stalled chip.
  const stalled = await db.issue.create({ data: { title: 'Stalled anneal run', status: 'IN_PROGRESS', creatorId: me, rank: 'a0' } })
  await db.issueActivity.create({
    data: { issueId: stalled.id, actorId: me, type: 'created', data: {}, createdAt: new Date(Date.now() - 20 * 86_400_000) },
  })
  const fresh = await db.issue.create({ data: { title: 'Fresh anneal run', status: 'IN_PROGRESS', creatorId: me, rank: 'a1' } })
  await db.issueActivity.create({ data: { issueId: fresh.id, actorId: me, type: 'created', data: {} } })

  await page.goto('/issues')
  const stalledRow = page.getByRole('listitem').filter({ hasText: 'Stalled anneal run' })
  await expect(stalledRow).toBeVisible()
  // `exact` keeps this off the filter bar's "Stalled only" option.
  await expect(stalledRow.getByText('Stalled', { exact: true })).toBeVisible()
  const freshRow = page.getByRole('listitem').filter({ hasText: 'Fresh anneal run' })
  await expect(freshRow).toBeVisible()
  await expect(freshRow.getByText('Stalled', { exact: true })).toHaveCount(0)

  await page.getByRole('combobox', { name: 'Activity' }).selectOption('true')
  await expect(page).toHaveURL(/stalled=true/)
  await expect(page.getByRole('listitem').filter({ hasText: 'Stalled anneal run' })).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Fresh anneal run' })).toHaveCount(0)
})

// ─────────────────────────────────────────────────────────────────────────────
test('5: "Lab today" renders five sections whose attention counts agree with /projects', async ({ browser }) => {
  test.setTimeout(180_000)
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  const me = await adminId()

  // The at_risk bucket is the only one the earlier tests leave empty, and the section
  // needs a non-zero TOTAL or it collapses into an EmptyState and the four labels
  // vanish. With this project the four rows are filled by (verified against the
  // rendered section, one project each):
  //   off_track  ← Zulu films      (test 3: lead + fresh OFF_TRACK)
  //   at_risk    ← Kilo films      (below:  lead + fresh AT_RISK)
  //   no_lead    ← Graphene growth (test 1: NO lead; its fresh ON_TRACK update falls
  //                                 past the off_track/at_risk arms into no_lead)
  //   no_update  ← Mike films      (test 3: lead, no update ever)
  // Papa films (PAUSED) is deliberately in none of them — the buckets are ACTIVE-only.
  const risky = await db.project.create({ data: { name: 'Kilo films', leadId: me, rank: 'B' } })
  await db.projectUpdate.create({ data: { projectId: risky.id, authorId: me, health: 'AT_RISK', body: 'Precursor delivery slipped a week.' } })

  // A REAL join writes a kind:'system' "X joined #lab-updates" row — the newest message
  // in the channel, so without the digest's kind:'user' term it would be row 1 of
  // section 4. Bob auto-joins at sign-up (a silent upsert, no event row), so drop that
  // membership and let him join through the browse dialog, which is the real path.
  const token = await createMemberViaInvite(page, BOB.email, 'member')
  const bob = await newPage(browser)
  await acceptInvite(bob, token, BOB.name, PASS)
  const bobId = (await db.user.findFirstOrThrow({ where: { email: BOB.email } })).id
  await db.conversationMember.deleteMany({ where: { conversationId: LAB_UPDATES_CHANNEL_ID, userId: bobId } })
  await bob.goto('/chat')
  await bob.getByRole('button', { name: 'Browse or create channels' }).click()
  const browse = bob.getByRole('dialog', { name: 'Channels' })
  await browse.locator('div.rounded-lg').filter({ hasText: 'lab-updates' }).getByRole('button', { name: 'Join' }).click()
  await bob.waitForURL('**/chat/' + LAB_UPDATES_CHANNEL_ID)
  await expect(log(bob).getByText(/joined #lab-updates/).first()).toBeVisible()
  await bob.context().close()

  // No pending bookings yet → no approvals banner.
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: 'Welcome, Roland' }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: /waiting for approval/ })).toHaveCount(0)

  // The five FIXED sections.
  for (const h of ['My issues', 'Today in the lab', 'Projects needing attention', 'Latest in #lab-updates', 'Recent files']) {
    await expect(page.getByRole('heading', { name: h })).toBeVisible()
  }

  // Section 4 shows real posts only: the bot's update announcement, never the join row.
  const digest = main(page).locator('section').filter({ hasText: 'Latest in #lab-updates' })
  await expect(digest.getByText(/posted an update on/).first()).toBeVisible()
  await expect(digest.getByText(/joined #lab-updates/)).toHaveCount(0)

  // Section 3: four fixed rows, and their counts sum to exactly what /projects?attention=1 lists.
  const attention = main(page).locator('section').filter({ hasText: 'Projects needing attention' })
  for (const label of ['Off track', 'At risk', 'No lead', 'No update in 3 weeks']) {
    await expect(attention.getByText(label, { exact: true })).toBeVisible()
  }
  // The only tabular-nums spans inside this section are the four count cells.
  const counts = await attention.locator('.tabular-nums').allTextContents()
  expect(counts).toHaveLength(4)
  const total = counts.reduce((n, t) => n + Number(t.trim()), 0)
  expect(total).toBeGreaterThan(0)
  await page.goto('/projects?attention=1')
  await expect(main(page).locator('a[href^="/projects/"]')).toHaveCount(total)

  // Approvals banner presence: one PENDING request the admin can approve.
  const eq = await db.equipment.create({ data: { name: 'sp8 furnace', approvalPolicy: 'ALL' } })
  const startsAt = new Date(Date.now() + 48 * 3_600_000)
  await db.booking.create({
    data: { userId: me, equipmentId: eq.id, status: 'PENDING', purpose: 'sp8 run', startsAt, endsAt: new Date(+startsAt + 2 * 3_600_000) },
  })
  await page.goto('/dashboard')
  await expect(page.getByRole('link', { name: /waiting for approval/ })).toBeVisible()

  // ── Guest posture: read every new surface, mutate none of them ──────────────
  const guestToken = await createMemberViaInvite(page, 'guest@lab.test', 'guest')
  const gp = await newPage(browser)
  await acceptInvite(gp, guestToken, 'Guesty', PASS)

  await gp.goto('/dashboard')
  for (const h of ['My issues', 'Today in the lab', 'Projects needing attention', 'Recent files']) {
    await expect(gp.getByRole('heading', { name: h })).toBeVisible()
  }
  await expect(gp.getByRole('link', { name: /waiting for approval/ })).toHaveCount(0) // never for guests
  await expect(gp.getByRole('button', { name: 'Post update' })).toHaveCount(0)

  await gp.goto('/projects')
  await expect(gp.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(gp.getByRole('heading', { name: 'Zulu films' })).toBeVisible()      // can read the review screen
  await expect(gp.getByRole('button', { name: 'New project' })).toHaveCount(0)

  await gp.goto(`/projects/${offTrackProjectId}`)
  await expect(gp.getByRole('heading', { name: 'Zulu films' })).toBeVisible()
  await expect(gp.getByRole('button', { name: 'Post update' })).toHaveCount(0)     // no composer affordance at all
  await expect(gp.getByRole('button', { name: 'Project actions' })).toHaveCount(0) // no snooze menu either
  await gp.context().close()
})

// ─────────────────────────────────────────────────────────────────────────────
test('6: the org update-prompt cadence controls are Monday-first over getDay() values', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/admin/settings')
  await expect(page.getByRole('heading', { name: 'Organisation settings' })).toBeVisible()
  // The lab week starts on Monday, but the STORED value is Date.getDay() (0 = Sunday).
  // Locking the first option's label↔value pairing is what keeps those two apart.
  const firstDay = page.locator('select[name=updatePromptDay] option').first()
  await expect(firstDay).toHaveText('Monday')
  await expect(firstDay).toHaveAttribute('value', '1')
  await expect(page.locator('select[name=updatePromptHour] option')).toHaveCount(24)
})

// ─────────────────────────────────────────────────────────────────────────────
// v0.15 §6.4 — the author corrects, then retracts, the newest update on the project
// tests 1 and 2 built. LAST in the serial file BY DESIGN: it rewrites and then
// tombstones that project's latest update, which tests 3–5 read (test 5 places
// Graphene growth in the no_lead bucket off its fresh ON_TRACK update).
test('7: an author edits then retracts an update; the header falls back to the previous one', async ({ browser }) => {
  test.setTimeout(120_000)
  const page = await newPage(browser)
  await signIn(page, ADMIN.email, ADMIN.password) // the admin authored BOTH updates
  await page.goto(`/projects/${projectId}`)

  // Test 2's captured update is the newest row (ON_TRACK); test 1's AT_RISK update
  // sits under it and is what the header must fall back to after the retraction.
  // The row is pinned by its ORIGIN CHIP, the one thing that survives both the body
  // rewrite and the health change — a body-text filter would stop matching the moment
  // the correction lands, and the tombstone drops the chip anyway.
  const row = main(page).getByRole('listitem').filter({ hasText: 'From a message in #growth' })
  await expect(row.getByText('Growth 14 looks textured')).toBeVisible()
  await expect(main(page).getByText('(edited)')).toHaveCount(0)

  // ── Correct it: new words AND a new health call ────────────────────────────
  await row.getByRole('button', { name: 'Update actions' }).click()
  await row.getByRole('menuitem', { name: 'Edit', exact: true }).click()
  const editor = row.getByRole('textbox', { name: 'Update' })
  await expect(editor).toHaveValue(/Growth 14 looks textured/) // prefilled with the stored body
  await editor.fill('Correction: the texture was substrate roughness, not growth.')
  // A label-wrapped <select> is located by ROLE, never getByLabel (which matches
  // the option text) — the v0.14 harness rule.
  await row.getByRole('combobox', { name: 'Health' }).selectOption('OFF_TRACK')
  await row.getByRole('button', { name: 'Save' }).click()

  await expect(row.getByText('Correction: the texture was substrate roughness')).toBeVisible()
  await expect(main(page).getByText('Growth 14 looks textured')).toHaveCount(0)
  await expect(row.getByText('Off track', { exact: true })).toBeVisible() // the row's own chip
  await expect(row.getByText('(edited)')).toBeVisible()
  // An edit is silent but not invisible: the header health chip reads the latest
  // update, so the whole page agrees on the new call (row + header = 2).
  await expect(main(page).getByText('Off track', { exact: true })).toHaveCount(2)

  // ── Retract it: a tombstone, not a hole ────────────────────────────────────
  await row.getByRole('button', { name: 'Update actions' }).click()
  await row.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete this update?' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Delete update' }).click()
  await expect(confirm).toBeHidden()

  const tomb = main(page).getByRole('listitem').filter({ hasText: 'update deleted' })
  await expect(tomb).toBeVisible()
  await expect(main(page).getByText('Correction: the texture was substrate roughness')).toHaveCount(0)
  // The retracted health call goes with the words — chip, origin chip and the row
  // menu are all gone, so nothing on the tombstone is actionable or judgemental.
  await expect(tomb.getByText('Off track', { exact: true })).toHaveCount(0)
  await expect(tomb.getByRole('link', { name: /From a message in #growth/ })).toHaveCount(0)
  await expect(tomb.getByRole('button', { name: 'Update actions' })).toHaveCount(0)
  // The header (and every "latest update" read behind it) falls back to test 1's
  // surviving AT_RISK update — the retracted OFF_TRACK is gone from the page.
  await expect(main(page).getByText('Off track', { exact: true })).toHaveCount(0)
  await expect(main(page).getByText('At risk', { exact: true })).toHaveCount(2) // header + the surviving row

  // ── The demoted-author hole ────────────────────────────────────────────────
  // canDeleteProjectUpdate keeps the comment-predicate shape (author-or-admin, no
  // guest term) because assertCanMutate refuses guests upstream — so a guest DOES
  // satisfy it on a row they authored. Seed exactly that row for the guest test 5
  // invited and prove the menu is gated on `role` too: the affordance must not
  // appear where it could only ever 403. Deliberately LAST — this update is newer
  // than the two above and would have moved the header chip.
  const guestId = (await db.user.findFirstOrThrow({ where: { email: 'guest@lab.test' } })).id
  await db.projectUpdate.create({ data: { projectId, authorId: guestId, health: 'ON_TRACK', body: 'Guest-authored line from before the demotion.' } })
  const gp = await newPage(browser)
  await signIn(gp, 'guest@lab.test', PASS)
  await gp.goto(`/projects/${projectId}`)
  const ownRow = main(gp).getByRole('listitem').filter({ hasText: 'Guest-authored line' })
  await expect(ownRow).toBeVisible()
  await expect(ownRow.getByRole('button', { name: 'Update actions' })).toHaveCount(0)
  await gp.context().close()
})
