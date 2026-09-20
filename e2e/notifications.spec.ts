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

// Task 9 (v0.32.0): the browser OS-popup arm. Headless Chromium can't render
// real OS popups, so Notification is faked via addInitScript (permission
// 'granted', every construction recorded — constructions, because the tag's
// replace-not-stack semantics are asserted by UNIQUE tags, not by absence).
// Covers: exactly-once per message (the 30 s poll never pops), the ≤100-char
// preview slice, silent:true (the chime is the sound), tag=cid replacement,
// click → focus + /chat/<cid> navigation, silence while the conversation is
// open and focused, and silence in a muted conversation — with a liveness
// re-check (one more unmuted popup) proving SSE still flowed through the
// quiet gap rather than the connection having died.
test('OS popups: once per message, same-tag replacement, silent when focused or muted', async ({ page, browser }) => {
  test.setTimeout(120_000)
  const me = await db.user.findFirstOrThrow({ where: { email: ADMIN.email } })

  // Bob joins via invite in his own context (unique rate-limit bucket).
  const token = await createMemberViaInvite(page, 'popupbob@lab.test', 'member')
  const bobCtx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.20.31.9' } })
  const bob = await bobCtx.newPage()
  await acceptInvite(bob, token, 'Popup Bob', 'MemberPass!1234')
  const bobUser = await db.user.findFirstOrThrow({ where: { email: 'popupbob@lab.test' } })

  // Three seeded channels: the popup target, one the VIEWER muted, and a
  // third unmuted one for the post-muted liveness re-check (by then the
  // viewer is INSIDE the popup target via the click navigation, where
  // open-and-focused suppression would rightly eat its messages).
  const conv = await db.conversation.create({ data: { type: 'CHANNEL', name: 'popup-chan', createdById: me.id } })
  const mutedConv = await db.conversation.create({ data: { type: 'CHANNEL', name: 'popup-muted', createdById: me.id } })
  const liveConv = await db.conversation.create({ data: { type: 'CHANNEL', name: 'popup-live', createdById: me.id } })
  await db.conversationMember.createMany({
    data: [
      { conversationId: conv.id, userId: me.id },
      { conversationId: conv.id, userId: bobUser.id },
      { conversationId: mutedConv.id, userId: me.id, muted: true },
      { conversationId: mutedConv.id, userId: bobUser.id },
      { conversationId: liveConv.id, userId: me.id },
      { conversationId: liveConv.id, userId: bobUser.id },
    ],
  })

  // Viewer: fake Notification grants permission and records constructions;
  // instances are kept so the test can invoke each popup's onclick (the
  // funnel assigns it after construction, so it is read at click time).
  await page.addInitScript(() => {
    const w = window as unknown as {
      __notifs: { title: string; body: string; tag: string; silent?: boolean }[]
      __notifInstances: { onclick: (() => void) | null }[]
      Notification: unknown
    }
    w.__notifs = []
    w.__notifInstances = []
    class FakeNotification {
      static permission = 'granted'
      static requestPermission() { return Promise.resolve('granted') }
      onclick: (() => void) | null = null
      close() {}
      constructor(title: string, opts: NotificationOptions) {
        w.__notifs.push({ title, body: opts.body ?? '', tag: opts.tag ?? '', silent: opts.silent ?? undefined })
        w.__notifInstances.push(this)
      }
    }
    w.Notification = FakeNotification
  })

  // Gate the store's readiness on BOTH seeded channels being loaded (the
  // SSE msg handler needs the conversation in the store before messages land).
  const convLoaded = page.waitForResponse(async (r) => {
    if (!r.url().includes('/api/chat/conversations')) return false
    const d = (await r.json()) as { conversations?: { id: string }[] }
    const ids = d.conversations?.map((c) => c.id) ?? []
    return ids.includes(conv.id) && ids.includes(mutedConv.id) && ids.includes(liveConv.id)
  }, { timeout: 30_000 })
  await page.goto('/dashboard')
  await waitForHydration(page)
  await convLoaded

  await bob.goto('/chat/' + conv.id)
  await expect(bob.getByRole('heading', { name: '#popup-chan' })).toBeVisible()
  const box = bob.getByPlaceholder('Write a message…')
  await box.fill('popup one')
  await box.press('Enter')
  await bob.waitForTimeout(500)
  await box.fill('popup two')
  await box.press('Enter')

  // Exactly once per message: 2 constructions, never 3+ (a double-fire would
  // show up here; the 30 s poll path never pops by design).
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __notifs?: unknown[] }).__notifs?.length ?? 0), { timeout: 20_000 })
    .toBe(2)
  const notifs = await page.evaluate(() => (window as unknown as { __notifs: { title: string; body: string; tag: string; silent?: boolean }[] }).__notifs)
  for (const n of notifs) {
    expect(n.title).toBe('#popup-chan')
    expect(n.tag).toBe(conv.id) // tag=cid: the second message REPLACES, never stacks
    expect(n.silent).toBe(true) // the chime is the sound — no double audio
    expect(n.body.length).toBeLessThanOrEqual(100) // preview slice
    expect(n.body.startsWith('Popup Bob: ')).toBe(true)
  }
  expect(new Set(notifs.map((n) => n.tag)).size).toBe(1) // same conversation → one live popup

  // Click: focus the tab and navigate to the conversation.
  await page.evaluate(() => (window as unknown as { __notifInstances: { onclick: (() => void) | null }[] }).__notifInstances[1].onclick?.())
  await page.waitForURL('**/chat/' + conv.id)

  // Open AND focused → no popup. Headless pages must actually hold focus for
  // this half, so assert the precondition instead of silently passing on a
  // focus-less tab (where suppression would wrongly look like success).
  await page.bringToFront()
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true)
  await box.fill('while you read')
  await box.press('Enter')
  // The message arriving in the viewer's own log proves the SSE event was
  // delivered — the bell funnel saw it too and chose silence.
  await expect(page.getByRole('log', { name: 'Messages' }).getByText('while you read')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(500) // any popup construction would land well inside this
  expect(await page.evaluate(() => (window as unknown as { __notifs: unknown[] }).__notifs.length)).toBe(2)

  // Muted conversation → no popup, with a liveness re-check after the gap.
  await bob.goto('/chat/' + mutedConv.id)
  await expect(bob.getByRole('heading', { name: '#popup-muted' })).toBeVisible()
  const mbox = bob.getByPlaceholder('Write a message…')
  await mbox.fill('muted hello')
  await mbox.press('Enter')
  await page.waitForTimeout(1_500) // SSE delivery is ~instant locally; only then assert quiet
  expect(await page.evaluate(() => (window as unknown as { __notifs: unknown[] }).__notifs.length)).toBe(2)
  // Liveness re-check in the third unmuted channel (the viewer never opened
  // it): one more popup proves SSE flowed through the muted quiet gap.
  await bob.goto('/chat/' + liveConv.id)
  await expect(bob.getByRole('heading', { name: '#popup-live' })).toBeVisible()
  const lbox = bob.getByPlaceholder('Write a message…')
  await lbox.fill('still alive')
  await lbox.press('Enter')
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __notifs?: unknown[] }).__notifs?.length ?? 0), { timeout: 20_000 })
    .toBe(3)

  await bobCtx.close()
})
