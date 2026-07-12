import { test, expect, type Browser, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { wipe, runWizard, signIn, ADMIN, createIssueViaUI } from './helpers'

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

// The accent-on label on the brand accent FILL (bg-accent) was adjudicated
// acceptable at the 3:1 WCAG non-text / UI-component bar — the redesign brief's
// carry-forward is explicit: "the brand teal itself sits ~3:1 and is approved — do
// not relitigate to 4.5:1". axe applies the 4.5:1 *text* bar to the button label,
// so we tolerate ONLY an accent-filled control (bg-accent, matched so it never
// catches bg-accent-subtle) whose measured ratio still clears 3:1 — symmetric
// across themes (white ink in light, dark ink in dark). Anything else, or below
// 3:1, still fails.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isApprovedAccentFill(node: any): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = node.any?.find((c: any) => c.id === 'color-contrast')?.data
  return !!d && /bg-accent(?![-\w])/.test(String(node.html ?? '')) && Number(d.contrastRatio) >= 3
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
    const { violations } = await new AxeBuilder({ page }).analyze()
    const bad = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => (v.id === 'color-contrast'
        ? { ...v, nodes: v.nodes.filter((n) => !isApprovedAccentFill(n)) }
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
  test.setTimeout(240_000) // core surfaces + 5 SP4 surfaces, each audited in both themes
  const page = await newPage(browser)
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  await expect(page.getByText('Welcome, Roland')).toBeVisible()
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
  await expect(page.getByRole('button', { name: /Search COLOSSUS/ })).toBeVisible()
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

  // SP4 surfaces — issues list/board, projects, issue detail, create modal.
  // Seed one issue so the list/board/detail render populated (createIssueViaUI
  // opens the composer, creates, and redirects to /issues/COL-1).
  await page.goto('/issues')
  await expect(page.getByRole('heading', { name: 'Issues' })).toBeVisible()
  await createIssueViaUI(page, 'A11y issue')

  await page.goto('/issues')
  await expect(page.getByText('A11y issue')).toBeVisible()
  await auditBothThemes(page, 'issues-list')

  await page.getByRole('button', { name: 'Board' }).click()
  await expect(page.getByRole('button', { name: 'Reorder COL-1' })).toBeVisible()
  await auditBothThemes(page, 'issues-board')

  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await auditBothThemes(page, 'projects')

  await page.goto('/issues/COL-1')
  await expect(page.getByRole('textbox', { name: 'Issue title' })).toHaveValue('A11y issue')
  await auditBothThemes(page, 'issue-detail')

  // Open the create-issue modal (role=dialog) and audit it in both themes. The
  // "New issue" trigger lives on the list surface (the issue-detail page has none).
  await page.goto('/issues')
  await expect(page.getByRole('heading', { name: 'Issues' })).toBeVisible()
  await page.getByRole('button', { name: 'New issue' }).first().click()
  await expect(page.getByRole('dialog', { name: 'New issue' })).toBeVisible()
  await auditBothThemes(page, 'create-issue')
  await page.keyboard.press('Escape')

  await page.context().close()
})
