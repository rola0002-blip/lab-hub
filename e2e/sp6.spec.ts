import { test, expect } from '@playwright/test'
import pkg from '../package.json'
import { wipe, runWizard, signIn, ADMIN } from './helpers'

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => { await wipe() })

test('version surface: sidebar footer + Settings About show the package version', async ({ page }) => {
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  // Sidebar footer (present on every authed page).
  await expect(page.getByText(`v${pkg.version}`)).toBeVisible()
  // Settings About block + (SMTP unset in e2e) the no-SMTP indicator lands here later (T4).
  await page.goto('/admin/settings')
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  await expect(page.getByText(`COLOSSUS v${pkg.version}`)).toBeVisible()
})

test('an admin creates an invite, copies the accept link, and it reaches the accept flow', async ({ page, context }) => {
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/people')
  await page.fill('input[name=email]', 'newbie@lab.test')
  await page.selectOption('select[name=role]', 'member')
  await page.click('button:has-text("Invite")')
  await expect(page.getByText('Invitation sent.')).toBeVisible()
  // The accept URL is rendered as a selectable readonly field — the guaranteed path on the
  // plain-HTTP LAN, where navigator.clipboard is undefined. Read it directly (NOT via the
  // clipboard) so this test actually exercises the production onboarding path, not just the
  // localhost-only secure-context clipboard.
  const url = await page.getByLabel('Invite link').first().inputValue()
  expect(url).toContain('/accept-invite/')
  // Copy button is progressive enhancement: on localhost (a secure context) the clipboard
  // write succeeds and toasts. Grant permission and assert the enhancement still works here.
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: 'Copy invite link' }).first().click()
  await expect(page.getByText('Invite link copied')).toBeVisible()
  // Visiting the surfaced URL reaches account creation — no SMTP required.
  await page.goto(new URL(url).pathname)
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
})

test('with SMTP unset, the Settings page shows the email-disabled indicator', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password)
  await page.goto('/admin/settings')
  await expect(page.getByText(/Email delivery: disabled/)).toBeVisible()
})
