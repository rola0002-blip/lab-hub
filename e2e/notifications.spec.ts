import { test, expect } from '@playwright/test'
import { wipe, runWizard, signIn, ADMIN, waitForHydration } from './helpers'

test.beforeEach(async ({ page }) => {
  await wipe()
  // wipe() empties the org, so every test re-runs the first-run wizard
  await runWizard(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  await waitForHydration(page)
})

test('activity heartbeat fires on load', async ({ page }) => {
  // The Bell mounts on every app page and useActivity sends immediately.
  const pinged = page.waitForRequest((r) => r.url().includes('/api/activity') && r.method() === 'POST', { timeout: 15_000 })
  await page.goto('/chat')
  await pinged
})

test('bell tray offers notification setup; wizard opens and closes', async ({ page }) => {
  // Headless Chromium reports Notification.permission 'denied' or 'default'
  // with no subscription — either way the tray must offer setup.
  await page.goto('/chat')
  await page.getByRole('button', { name: 'Notifications' }).click()
  await page.getByRole('button', { name: 'Set up notifications' }).click()
  await expect(page.getByRole('dialog', { name: 'Get notified' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Get notified' })).not.toBeVisible()
})

test('push test endpoint answers ok for a signed-in member', async ({ page }) => {
  await page.goto('/chat')
  const status = await page.evaluate(() => fetch('/api/push/test', { method: 'POST' }).then((r) => r.status))
  expect(status).toBe(200)
})
