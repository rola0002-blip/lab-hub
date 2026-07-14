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
