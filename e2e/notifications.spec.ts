import { test, expect } from '@playwright/test'
import { wipe, runWizard, signIn, ADMIN, waitForHydration, db } from './helpers'

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

test('setup row stays visible without scrolling when the list overflows', async ({ page }) => {
  // Seed BEFORE first visit so even a mount-time fetch sees the rows.
  const me = await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })
  await db.notification.createMany({
    data: Array.from({ length: 12 }, (_, i) => ({
      userId: me.id, type: 'issue_assigned', payload: { message: `overflow row ${i}` },
    })),
  })
  await page.setViewportSize({ width: 1280, height: 500 }) // 70vh tray = 350px < 12 rows
  await page.goto('/chat')
  await page.getByRole('button', { name: 'Notifications' }).click()
  const setup = page.getByRole('button', { name: 'Set up notifications' })
  await expect(setup).toBeVisible()
  const box = await setup.boundingBox()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(500)
  // The list really is populated AND scrolls in its own region — not an empty-tray fluke.
  await expect(page.getByText('overflow row 11')).toBeVisible()
})
