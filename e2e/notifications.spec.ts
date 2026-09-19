import { test, expect } from '@playwright/test'
import { wipe, runWizard, signIn, ADMIN, waitForHydration, db, createMemberViaInvite, acceptInvite } from './helpers'

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

// Task 8 (v0.32.0): every qualifying message alerts — the 3 s burst throttle
// is gone. Headless Chromium can't hear WebAudio and Notification.permission
// is denied, so the chime is observed through a fake AudioContext counting
// oscillator starts (playChime schedules exactly 2 taps per chime): two
// messages sent under 3 s apart must BOTH chime (4 taps). Under the old
// PingThrottle the second was swallowed at 2 taps — this spec is its
// regression pin.
test('every message chimes: a 2-message burst under 3 s sounds twice (no throttle)', async ({ page, browser }) => {
  test.setTimeout(120_000)
  const me = await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })

  // Bob joins via invite in his own context (unique client IP — the
  // messaging.spec rate-limit-bucket pattern).
  const token = await createMemberViaInvite(page, 'chimebob@lab.test', 'member')
  const bobCtx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.20.31.7' } })
  const bob = await bobCtx.newPage()
  await acceptInvite(bob, token, 'Chime Bob', 'MemberPass!1234')
  const bobUser = await db.user.findFirstOrThrow({ where: { email: 'chimebob@lab.test' } })

  // Seed the channel + both memberships directly (no UI churn): both pages
  // load AFTER this, so each one's fresh SSE subscription snapshot covers it.
  const conv = await db.conversation.create({
    data: { type: 'CHANNEL', name: 'burst-chime', createdById: me.id },
  })
  await db.conversationMember.createMany({
    data: [
      { conversationId: conv.id, userId: me.id },
      { conversationId: conv.id, userId: bobUser.id },
    ],
  })

  // Viewer (admin): fake AudioContext counts chime taps; sounds on for this
  // device. Both armed before the dashboard load so the Bell reads them at
  // mount (addInitScript applies to this and later navigations only).
  await page.addInitScript(() => {
    localStorage.setItem('sounds', '1')
    const w = window as unknown as { __chimeTaps: number; AudioContext: unknown }
    w.__chimeTaps = 0
    class FakeParam {
      setValueAtTime() {}
      exponentialRampToValueAtTime() {}
    }
    class FakeOsc {
      type = ''
      frequency = new FakeParam()
      connect() {}
      start() { w.__chimeTaps += 1 }
      stop() {}
    }
    class FakeGain {
      gain = new FakeParam()
      connect() {}
    }
    class FakeFilter {
      type = ''
      frequency = { value: 0 }
      connect() {}
    }
    class FakeAudioContext {
      state = 'running'
      currentTime = 0
      get destination() { return {} }
      resume() { return Promise.resolve() }
      createOscillator() { return new FakeOsc() }
      createGain() { return new FakeGain() }
      createBiquadFilter() { return new FakeFilter() }
    }
    w.AudioContext = FakeAudioContext
  })
  // The conversation rail only exists on /chat pages, so gate the store's
  // readiness on the conversations fetch itself: resolve only when the
  // response actually carries the seeded channel (the SSE msg handler needs
  // it loaded before Bob's messages land).
  const convLoaded = page.waitForResponse(async (r) => {
    if (!r.url().includes('/api/chat/conversations')) return false
    const d = (await r.json()) as { conversations?: { id: string }[] }
    return d.conversations?.some((c) => c.id === conv.id) ?? false
  }, { timeout: 30_000 })
  await page.goto('/dashboard')
  await waitForHydration(page)
  await convLoaded

  await bob.goto('/chat/' + conv.id)
  await expect(bob.getByRole('heading', { name: '#burst-chime' })).toBeVisible()
  const box = bob.getByPlaceholder('Write a message…')
  await box.fill('burst one')
  await box.press('Enter')
  await bob.waitForTimeout(500) // well inside the old 3 s throttle window
  await box.fill('burst two')
  await box.press('Enter')

  // 2 taps per chime × 2 chimes; under the throttle the count sticks at 2.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __chimeTaps?: number }).__chimeTaps ?? 0), { timeout: 20_000 })
    .toBe(4)

  await bobCtx.close()
})
