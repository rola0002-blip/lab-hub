import { test, expect, type Browser, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { wipe, runWizard, signIn, ADMIN, createIssueViaUI, createMemberViaInvite, acceptInvite, db } from './helpers'

// axe-core accessibility floor. For each core surface — the sign-in page, the
// dashboard, a channel view, an open modal (the ⌘K command palette), and the
// profile page — assert zero serious/critical violations in BOTH themes. This is
// the automated companion to scripts/check-contrast.mjs (which gates the token
// pairs a static page never renders).

// Per-context client IP so better-auth's per-IP sign-in/up rate limit never trips
// (mirrors the other serial suites); a distinct 10.30.x band avoids collisions.
let ipSeq = 0
async function newPage(browser: Browser): Promise<Page> {
  ipSeq += 1
  // reducedMotion: the globals.css reduced-motion reset zeroes transition
  // durations, so a theme flip lands on its final colors immediately — otherwise
  // axe can sample a `transition-colors` button mid-fade and read a bogus
  // intermediate contrast.
  const ctx = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': `10.30.${ipSeq}.7` },
    reducedMotion: 'reduce',
  })
  return ctx.newPage()
}

test.describe.configure({ mode: 'serial' })
test.beforeEach(async () => { await wipe() })

// A real 1x1 PNG for the feedback composer's attachment row (saveUpload trusts the
// declared mime, but the preview is a genuine blob: URL the browser has to decode).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

// The accent-on label on the brand accent FILL (bg-accent) was adjudicated
// acceptable at the 3:1 WCAG non-text / UI-component bar — the redesign brief's
// carry-forward is explicit: "the brand teal itself sits ~3:1 and is approved — do
// not relitigate to 4.5:1". axe applies the 4.5:1 *text* bar to the button label,
// so we tolerate ONLY a control whose measured background IS the accent fill and
// whose ratio still clears 3:1 — symmetric across themes (white ink in light, dark
// ink in dark). Anything else, or below 3:1, still fails.
//
// Matched by measured COLOUR, not by the class string: axe caps its serialised start
// tag at 300 characters and silently DROPS the attributes that overflow, so a control
// with a long utility list (the v0.13 "Send feedback" button is the first) arrives here
// with no `class` attribute at all and the old /bg-accent/ html test could never see it.
// bg-accent-subtle resolves to a different colour, so the distinction the old negative
// lookahead protected is preserved.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isApprovedAccentFill(node: any, accent: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = node.any?.find((c: any) => c.id === 'color-contrast')?.data
  return !!d && String(d.bgColor).toLowerCase() === accent && Number(d.contrastRatio) >= 3
}

// The accent fill as painted RIGHT NOW, in the '#rrggbb' form axe reports in
// `data.bgColor`. Measured off a throwaway probe rather than read from `--accent`, so a
// color-mix()/var() chain resolves exactly the way the browser painted the real control.
//
// FAIL-CLOSED, deliberately: if `bg-accent` ever stops resolving, getComputedStyle
// returns the transparent 'rgba(0, 0, 0, 0)', which the old parse folded to '#000000'
// — and '#000000' is a REAL background, so the tolerance above would have quietly
// excused every true-black-backed contrast failure in the audit. A probe that cannot
// be read is a broken harness, not a passing one, so it throws.
async function accentFillHex(page: Page): Promise<string> {
  const painted = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.className = 'bg-accent'
    probe.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px'
    document.body.appendChild(probe)
    const value = getComputedStyle(probe).backgroundColor
    probe.remove()
    return value
  })
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(painted)
  if (!m) throw new Error(`a11y harness: bg-accent did not resolve to an rgb() colour (got "${painted}") — the accent-fill tolerance cannot be matched.`)
  if (m[4] !== undefined && Number(m[4]) === 0) throw new Error(`a11y harness: bg-accent resolved to a fully transparent colour ("${painted}") — the accent fill is not painting.`)
  return '#' + m.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('')
}

// Force the theme deterministically (the pre-paint boot script reads localStorage
// on every navigation) and run axe, failing on any serious/critical violation.
async function auditBothThemes(page: Page, where: string) {
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t
      try { localStorage.setItem('theme', t) } catch { /* private mode */ }
      // Flush two frames so the recolor is fully committed before axe samples.
      return new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    }, theme)
    const accent = await accentFillHex(page) // per-theme: teal-600 in light, teal-500 in dark
    const { violations } = await new AxeBuilder({ page }).analyze()
    const bad = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => (v.id === 'color-contrast'
        ? { ...v, nodes: v.nodes.filter((n) => !isApprovedAccentFill(n, accent)) }
        : v))
      .filter((v) => v.nodes.length > 0)
    const summary = bad.map((v) => `${v.id}[${v.impact}]×${v.nodes.length}`).join(', ') || 'none'
    expect(bad, `${where} (${theme}) serious/critical: ${summary}`).toEqual([])
  }
}

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

test('sign-in: no serious/critical axe violations, both themes', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await newPage(browser)
  await runWizard(page) // creates the org, lands on /sign-in
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await auditBothThemes(page, 'sign-in')
  await page.context().close()
})

test('app surfaces: no serious/critical axe violations, both themes', async ({ browser }) => {
  test.setTimeout(540_000) // core + SP4 + SP5 (files/bookings) + SP6 (settings/people) + SP8 (health projects + update modal) + v0.11 (back button + delete confirm) + v0.13 (feedback admin/member/composer, which also provisions a member via invite), each audited in both themes
  const page = await newPage(browser)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/dashboard') // v0.9.5 lands sign-in on /issues/me; audit the dashboard explicitly
  await expect(page.getByRole('heading', { name: 'Welcome, Roland' }).first()).toBeVisible()
  await auditBothThemes(page, 'dashboard')

  // A populated channel view (message + composer + hover toolbar reachable).
  await createChannel(page, 'a11y')
  const box = page.getByPlaceholder('Write a message…')
  await box.fill('Accessibility smoke message')
  await box.press('Enter')
  await expect(page.getByText('Accessibility smoke message')).toBeVisible()
  await expect(box).toHaveValue('')
  // Reload to a settled, caught-up channel (markRead has landed, so there is no
  // own-message "New messages" unread divider) — the representative read state.
  await page.reload()
  await expect(page.getByText('Accessibility smoke message')).toBeVisible()
  await auditBothThemes(page, 'channel')

  // A modal open — the ⌘K command palette (role=dialog). Retry the one-shot
  // keypress until the dialog appears (it can fire a frame before the listener).
  await expect(page.getByRole('button', { name: /Search LabHub/ })).toBeVisible()
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10_000 })
  await auditBothThemes(page, 'command-palette')
  await page.keyboard.press('Escape')

  // Profile (Step 5a) — AccentPicker radiogroup + avatar upload control.
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
  await auditBothThemes(page, 'profile')

  // /files carrying a folder + a document (spec §6.8). Seed directly so the table,
  // drop zone and row menu render for the axe pass. The document lands at ROOT
  // (folderId: null) — the audit visits /files (root), so a doc nested in the folder
  // would leave root showing the EmptyState instead of the populated table + row menu.
  // The folder itself still renders in the rail (with its folder-actions menu).
  const meFiles = await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })
  await db.documentFolder.create({ data: { name: 'a11y protocols', createdById: meFiles.id } })
  await db.document.create({ data: { name: 'a11y sop.pdf', path: '/uploads/documents/a11y.pdf', mime: 'application/pdf', size: 2048, uploaderId: meFiles.id, folderId: null } })
  await page.goto('/files')
  await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible()
  await auditBothThemes(page, 'files')

  // /bookings carrying the add-to-calendar control (spec §4.5). Instant-confirm a
  // booking on a NONE-policy instrument for the signed-in admin so the control renders.
  const me = await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })
  const eqA11y = await db.equipment.create({ data: { name: 'a11y furnace', approvalPolicy: 'NONE' } })
  const startsA11y = new Date(Date.now() + 24 * 3_600_000)
  await db.booking.create({ data: { userId: me.id, equipmentId: eqA11y.id, status: 'CONFIRMED', purpose: 'a11y run', startsAt: startsA11y, endsAt: new Date(+startsA11y + 2 * 3_600_000) } })
  await page.goto('/bookings')
  await expect(page.getByRole('button', { name: 'Add to calendar' }).first()).toBeVisible()
  await auditBothThemes(page, 'bookings')

  // /admin/settings — About block + (SMTP-unset) no-SMTP indicator + sidebar version.
  await page.goto('/admin/settings')
  await expect(page.getByRole('heading', { name: 'Organisation settings' })).toBeVisible()
  await auditBothThemes(page, 'settings')

  // /people carrying a pending invitation so the Copy-link control renders for axe.
  const meP = await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })
  await db.invitation.create({ data: { email: 'pending@lab.test', role: 'member', token: 'a11y-invite-tok', invitedById: meP.id, expiresAt: new Date(Date.now() + 86_400_000) } })
  await page.goto('/people')
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible()
  await auditBothThemes(page, 'people')

  // SP4 surfaces — issues list/board, projects, issue detail, create modal.
  // Seed one issue so the list/board/detail render populated (createIssueViaUI
  // opens the composer, creates, and redirects to /issues/LAB-1).
  await page.goto('/issues')
  await expect(page.getByRole('heading', { name: 'Issues' })).toBeVisible()
  await createIssueViaUI(page, 'A11y issue')

  await page.goto('/issues')
  await expect(page.getByText('A11y issue')).toBeVisible()
  await auditBothThemes(page, 'issues-list')

  await page.getByRole('button', { name: 'Board' }).click()
  await expect(page.getByRole('button', { name: 'Reorder LAB-1' })).toBeVisible()
  await auditBothThemes(page, 'issues-board')

  // SP8 surfaces — /projects only renders the new --health-* glyph chips, the
  // "No lead" chip and the worst-first ordering when there is health data to render,
  // so seed it first (the /files seeding precedent above). One fresh OFF_TRACK
  // project plus one lead-less ACTIVE project puts every new mark on the page.
  // v0.12: `Project.rank` is NOT NULL with no default, so a raw create must supply
  // one. Explicit ascending literals ('B' < 'C' byte-wise, the COLLATE "C" order)
  // rather than a rank.ts import — Playwright's runner would have to resolve the
  // module graph, and the literals also make the expected arrangement self-evident.
  const meSp8 = await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })
  const offTrack = await db.project.create({ data: { name: 'a11y off-track growth', leadId: meSp8.id, rank: 'B' } })
  await db.projectUpdate.create({ data: { projectId: offTrack.id, authorId: meSp8.id, health: 'OFF_TRACK', body: 'Chamber leak — seal rebuilt, growths halted.' } })
  await db.project.create({ data: { name: 'a11y unowned survey', rank: 'C' } }) // no lead → the "No lead" chip

  // The admin is not a guest and no filter is applied, so the grid renders the v0.12
  // arrangement affordances — the grip and the Move menu are inside this audit
  // (the issues-board precedent at 'Reorder LAB-1' above).
  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'a11y off-track growth' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reorder a11y off-track growth' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Move a11y off-track growth' })).toBeVisible()
  await auditBothThemes(page, 'projects')

  // The project-update composer (role=dialog): the health radio group's non-colour
  // checked state, the glyph fills and the textarea, audited in both themes.
  // Rooted at <main>: Next's dev SSR keeps a hidden duplicate of the streamed tree
  // in `div#S:0` at body level, which a bare CSS locator would also match.
  await page.getByRole('main').locator('a[href^="/projects/"]').first().click()
  await page.waitForURL(/\/projects\/[^/]+$/)
  await page.getByRole('button', { name: 'Post update' }).first().click()
  await expect(page.getByRole('dialog', { name: 'Post project update' })).toBeVisible()
  await auditBothThemes(page, 'project-update-modal')
  await page.keyboard.press('Escape')

  await page.goto('/issues/LAB-1')
  await expect(page.getByRole('textbox', { name: 'Issue title' })).toHaveValue('A11y issue')
  await auditBothThemes(page, 'issue-detail')

  // v0.11 — the top-bar back button renders ONLY behind in-app history, so a page.goto
  // could never put it on screen: reach the issue detail by CLICKING the list row, then
  // audit the detail with the new control present.
  await page.goto('/issues')
  await expect(page.getByRole('heading', { name: 'Issues' })).toBeVisible()
  await page.getByRole('main').getByRole('link', { name: /LAB-1/ }).first().click()
  await page.waitForURL('**/issues/LAB-1')
  // `exact: true`: the accessible-name match is a substring by default, and the v0.13
  // sidebar footer added a "Give feedback" button — which "Back" now also matches,
  // making this locator strict-mode ambiguous. The top-bar control's name is exactly "Back".
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible()
  await auditBothThemes(page, 'issue-detail-with-back')

  // v0.11 — the delete confirmation (role=dialog), including its danger-filled button.
  // Escape dismisses it: LAB-1 must survive for the create-issue audit below.
  await page.getByRole('button', { name: 'Issue actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete issue' }).click()
  await expect(page.getByRole('dialog', { name: 'Delete issue?' })).toBeVisible()
  await auditBothThemes(page, 'delete-issue-confirm')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Delete issue?' })).toHaveCount(0)

  // Open the create-issue modal (role=dialog) and audit it in both themes. The
  // "New issue" trigger lives on the list surface (the issue-detail page has none).
  await page.goto('/issues')
  await expect(page.getByRole('heading', { name: 'Issues' })).toBeVisible()
  await page.getByRole('button', { name: 'New issue' }).first().click()
  await expect(page.getByRole('dialog', { name: 'New issue' })).toBeVisible()
  await auditBothThemes(page, 'create-issue')
  await page.keyboard.press('Escape')

  // v0.13 /feedback is ROLE-ADAPTIVE, not role-gated, so both shapes are audited: the
  // admin's (review queue — two filter chip groups, an author row, the per-row status
  // Menu trigger) and a member's (My feedback alone, which is the a11y-side proof the
  // queue section is absent). Seeded directly, the /files + SP8 precedent.
  //
  // AVATAR DETERMINISM — load-bearing: <Avatar> paints white initials on
  // hsl(avatarHue(id) 45% 42%), and the hue comes from the RANDOM better-auth user id, so
  // the ratio swings 3.53:1 (green) … 9.19:1 (blue). axe reports a ONE-character text node
  // as INCOMPLETE ('shortTextContent' — too short to tell text from an icon) and only a
  // TWO-character monogram as a violation, which is why every account in this file has a
  // SINGLE-WORD display name ('Roland', 'Mira') and why the queue's author row is safe.
  // Give a seeded user a two-word name here and this suite becomes a ~46%-per-run coin
  // flip on a defect that has nothing to do with the surface under audit. (The avatarHue
  // palette fix itself is tracked separately.)
  const fbToken = await createMemberViaInvite(page, 'feedback@lab.test', 'member')
  const mp = await newPage(browser)
  await acceptInvite(mp, fbToken, 'Mira', 'MemberPass!1234')
  const mira = await db.user.findFirstOrThrow({ where: { email: 'feedback@lab.test' } })
  const meFb = await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })
  const FB = { appVersion: '0.0.0-a11y', userAgent: 'Mozilla/5.0 (a11y probe)' }
  // NEW → the queue's default status filter shows it (warning chip + author + status Menu);
  // PLANNED → the admin's own row below, so a success chip is on the page too.
  await db.feedback.create({ data: { ...FB, type: 'BUG', status: 'NEW', pagePath: '/booking', body: 'The booking grid shows an extra hour after the clocks change.', authorId: mira.id } })
  await db.feedback.create({ data: { ...FB, type: 'IDEA', status: 'PLANNED', pagePath: '/projects', body: 'Let the calendar feed carry the instrument location.', authorId: meFb.id } })

  await page.goto('/feedback')
  await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Change status of feedback from Mira' })).toBeVisible()
  await auditBothThemes(page, 'feedback-admin')

  await mp.goto('/feedback')
  await expect(mp.getByRole('heading', { name: 'My feedback' })).toBeVisible()
  await expect(mp.getByRole('heading', { name: 'Review queue' })).toHaveCount(0)
  await auditBothThemes(mp, 'feedback-member')

  // The composer (role=dialog) in its RICH state: a chosen type (the aria-pressed
  // selected fill), a filled textarea, and the attachment row's thumbnail + Remove
  // control — an empty composer would leave the submit button disabled, and axe skips
  // disabled controls, so the accent-filled "Send feedback" would go unaudited.
  await page.getByRole('button', { name: 'Give feedback' }).click()
  const composer = page.getByRole('dialog', { name: 'Give feedback' })
  await expect(composer).toBeVisible()
  await composer.getByRole('button', { name: 'Bug' }).click()
  await composer.getByLabel('Details').fill('Axe pass: the composer with every control in its filled state.')
  await composer.locator('input[type=file]').setInputFiles({ name: 'a11y.png', mimeType: 'image/png', buffer: PNG })
  await expect(composer.getByRole('button', { name: 'Remove screenshot' })).toBeVisible()
  await auditBothThemes(page, 'feedback-composer')
  await page.keyboard.press('Escape')

  await mp.context().close()
  await page.context().close()
})
