'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Bell as BellIcon, BellPlus, Check, Hash, AtSign, MessageSquare,
  CalendarClock, CalendarCheck, CalendarX, UserPlus, CircleCheck, ClipboardCheck, Megaphone,
  GraduationCap, Smartphone, X,
  type LucideIcon,
} from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import { renderBody } from '@/features/chat/mentions'
import { humanTime } from '@/lib/humanize'
import { notificationHref } from '@/lib/notification-href'
import { rowAlerts, shouldAlertRow, shouldPingFromMessage, decideAlert, type AlertRow } from '@/lib/chime'
import { NOTIFICATION_LABEL, notificationTitle } from '@/lib/notification-label'
import { inStandalonePwa } from '@/lib/pwa-context'
import { popupPref } from '@/lib/popup-pref'
import { useNotificationStatus } from './hooks/use-notification-state'
import { NotificationWizard } from './notification-wizard'
import { useInstallPrompt } from './hooks/use-install-prompt'
import { useSoundsEnabled } from './hooks/use-sounds'
import { useActivity } from './hooks/use-activity'
import { useChat } from './chat/chat-store'
import { useEvents } from './use-events'

type Item = { id: string; type: string; payload: Record<string, string>; readAt: string | null; createdAt: string }

// Per-type glyph for the actor square when there's no person avatar to show
// (booking events, and chat events whose conversation resolves to a channel).
const TYPE_ICON: Record<string, LucideIcon> = {
  booking_pending: CalendarClock,
  booking_decided: CalendarCheck,
  booking_cancelled_maintenance: CalendarX,
  booking_reminder: CalendarClock,
  booking_expired: CalendarX,
  booking_cancelled: CalendarX,
  message_mention: AtSign,
  message_dm: MessageSquare,
  message_thread_reply: MessageSquare,
  channel_added: Hash,
  issue_assigned: UserPlus,
  issue_mention: AtSign,
  issue_comment: MessageSquare,
  issue_done: CircleCheck,
  project_update_prompt: ClipboardCheck,
  feedback_new: Megaphone,
  feedback_decided: Megaphone,
  training_request: GraduationCap,
  training_decided: GraduationCap,
}

let audioCtx: AudioContext | null = null
function playChime() {
  try {
    audioCtx ??= new AudioContext()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    const t = audioCtx.currentTime
    // Slack-like "knock brush" (wave 9 D6): two quick soft taps with a slight
    // pitch drop, ~170 ms total — richer than the old A5→E6 sine pair, still
    // pure synthesis (no binary asset, no licensing surface).
    const lp = audioCtx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2400
    lp.connect(audioCtx.destination)
    const tap = (at: number, from: number, to: number, peak: number) => {
      const o = audioCtx!.createOscillator()
      const g = audioCtx!.createGain()
      o.type = 'sine'
      o.frequency.setValueAtTime(from, t + at)
      o.frequency.exponentialRampToValueAtTime(to, t + at + 0.06)
      g.gain.setValueAtTime(0.0001, t + at)
      g.gain.exponentialRampToValueAtTime(peak, t + at + 0.005)
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.09)
      o.connect(g)
      g.connect(lp)
      o.start(t + at)
      o.stop(t + at + 0.1)
    }
    tap(0, 1150, 900, 0.2)
    tap(0.07, 950, 750, 0.16)
  } catch {
    /* Construction failures only (headless/embedded). Suspended-context
       degradation is silent-by-design, unchanged. */
  }
}

// iOS starts non-gesture AudioContexts suspended and ignores gesture-less
// resume() — create + resume on the FIRST user gesture so chimes are audible
// from cold load. Behavior-preserving no-op on desktop/Android.
function primeChime() {
  try {
    audioCtx ??= new AudioContext()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
  } catch { /* headless/embedded */ }
}

type Face =
  | { kind: 'user'; id: string; name: string; image: string | null }
  | { kind: 'glyph'; icon: LucideIcon }

// Collapse consecutive notifications about the SAME conversation into one group
// (they share one actor face). Items arrive newest-first; a run only merges when
// both rows carry the same defined conversationId, so booking notifications (no
// conversation) each stand alone.
function groupItems(items: Item[]): { key: string; items: Item[] }[] {
  const groups: { key: string; items: Item[] }[] = []
  for (const it of items) {
    const cid = it.payload?.conversationId
    const last = groups[groups.length - 1]
    if (cid && last && last.items[0].payload?.conversationId === cid) last.items.push(it)
    else groups.push({ key: it.id, items: [it] })
  }
  return groups
}

// soundsSeed carries the server-side User.soundsEnabled default into the Bell
// (same ThemeSync prop route): useSoundsEnabled falls back to it only while
// this device has no localStorage choice, so the device always wins locally.
export default function Bell({ soundsSeed = false }: { soundsSeed?: boolean }) {
  const { conversations, users, selfId } = useChat()
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState<Item[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const now = new Date() // viewer-local reference for humanized notification times
  // Wizard state lives in this tray. refresh is useCallback-stable (see
  // use-notification-state), so closeWizard below keeps one identity across
  // the 30 s poll / SSE re-renders — an inline onClose would give the
  // wizard's open-transition effect a fresh key every render.
  const { status: notifyState, refresh: refreshNotify } = useNotificationStatus()
  const [wizardOpen, setWizardOpen] = useState(false)
  const notifyAttention = notifyState !== null && notifyState !== 'shell' && notifyState !== 'done'
  const closeWizard = useCallback(() => { setWizardOpen(false); refreshNotify() }, [refreshNotify])
  const install = useInstallPrompt() // PWA install affordance lives in this tray too
  const { enabled: sounds } = useSoundsEnabled(soundsSeed) // server seed until the device opts in/out itself
  useActivity() // activity heartbeat feeding the server's push-idle gate
  // load is memoized (stable across renders), so it would capture a stale
  // `sounds`; mirror the live value into a ref it can read at fetch time.
  const soundsRef = useRef(false)
  useEffect(() => { soundsRef.current = sounds }, [sounds])
  useEffect(() => {
    // One gesture is enough to unlock iOS audio for the page lifetime.
    const opts: AddEventListenerOptions = { once: true, passive: true }
    window.addEventListener('pointerdown', primeChime, opts)
    window.addEventListener('keydown', primeChime, opts)
    return () => {
      window.removeEventListener('pointerdown', primeChime)
      window.removeEventListener('keydown', primeChime)
    }
  }, [])
  const watermark = useRef<string | null>(null)
  // The open conversation (route-derived — the store deliberately does not know
  // it; /chat/<cid> is the only place a conversation is "open"). The SSE msg
  // handler below reads it live from this render's closure (useEvents re-reads
  // the closure every render); only the memoized load() needs the ref mirror.
  const pathname = usePathname()
  const openCid = pathname.match(/^\/chat\/([^/]+)/)?.[1] ?? null
  // load() is memoized (stable across renders), so it reads the open conversation
  // through this ref mirror (the soundsRef idiom) for the row focus rule.
  const openCidRef = useRef(openCid)
  useEffect(() => { openCidRef.current = openCid }, [openCid])
  // Task 9: popup clicks navigate to the alert's url (the conversation, or a
  // bell row's target since W20-C). Bell had no router
  // (pathname was enough until now); the App Router's useRouter is
  // referentially stable, so the funnel's useCallback just lists it — soft
  // nav keeps the SSE subscription and chat store alive, unlike a
  // window.location.assign full reload.
  const router = useRouter()

  // The single alert funnel (Task 8; W20-C): EVERY qualifying message AND every
  // alertable bell row runs this — no burst throttle (a row batch chimes once).
  // WHERE the alert renders (decideAlert): in the desktop
  // shell every alert becomes an OS-sounded native toast (the shell bridges
  // Notification natively and attaches the OS sound) and the in-page chime
  // stays silent — exactly one sound. Browsers/PWA keep the WebAudio chime
  // plus (Task 9) a SILENT browser OS popup — silent because the chime is
  // the sound there; no double audio. The popup is per-device optional
  // (labhub.popups) and needs the plain Notification permission the wizard's
  // Browser popups step grants. The shell toast renders regardless of the
  // sound toggle — `silent` carries the toggle — while in browsers sounds-off
  // still means total silence. `__TAURI__` exists only in the Tauri
  // webviews, and the app never requests direct Notification permission in
  // browsers outside that wizard step, so a 'granted' permission in a normal
  // browser means either the wizard step or a push subscription whose toasts
  // the SW already shows — gating the popup arm on the shell marker
  // prevents a second toast from here in-shell. `url` is the click target:
  // /chat/<cid> for a message, notificationHref(row) for a bell row.
  const raiseAlert = useCallback((alert: { title: string; body: string; tag: string; url: string }, opts: { chime?: boolean } = {}) => {
    const { chime, toast, popup, swPopup } = decideAlert(true, '__TAURI__' in window, inStandalonePwa())
    if (toast && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        // silent: respects the per-device sound toggle — the shell's OS
        // toast sound is the sound (the chime never runs here). The shim
        // ignores tag/url: a shell toast focuses the right server, no deep link.
        const o: NotificationOptions = { body: alert.body, silent: !soundsRef.current }
        o.tag = alert.tag
        const t = new Notification(alert.title, o)
        t.onclick = () => window.focus()
      } catch { /* best-effort */ }
      return
    }
    if (swPopup && popupPref() && typeof Notification !== 'undefined' && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
      // Installed mobile PWAs (iOS 16.4+, Android Chrome) throw on the
      // page-context Notification constructor — the SW's showNotification
      // is the only OS-popup surface there. silent + the chime below keeps
      // the one-sound rule; notificationclick in sw.js owns focus+navigate
      // through data.url. Best-effort: the chime still covers the alert.
      void navigator.serviceWorker.ready
        .then((reg) =>
          reg.showNotification(alert.title, {
            body: alert.body.slice(0, 100),
            silent: true,
            tag: alert.tag,
            data: { url: alert.url },
          }),
        )
        .catch(() => { /* best-effort */ })
    }
    if (popup && popupPref() && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        // silent: the WebAudio chime below is the sound in browsers — the
        // popup must not double it. tag: a same-conversation (chat) or
        // same-type (bell row) burst replaces the popup instead of stacking.
        const o: NotificationOptions = { body: alert.body.slice(0, 100), silent: true }
        o.tag = alert.tag
        const t = new Notification(alert.title, o)
        t.onclick = () => { window.focus(); router.push(alert.url) }
      } catch { /* some platforms throw on construction — the chime still covers the alert */ }
    }
    // opts.chime === false: a multi-row batch chimes once (on its last row).
    if (chime && soundsRef.current && opts.chime !== false) playChime()
  }, [router])

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/notifications')
      if (!r.ok) return
      const d = await r.json()
      setUnread(d.unread); setItems(d.items)
      // W20-C: the bell ROW is the alert source for everything the realtime msg
      // path does not alert — every non-chat type, plus bot-sent chat rows.
      // rowAlerts diffs against the watermark, so the 30 s poll, a notif event
      // and a reconnect can each surface a row but never the same row twice, and
      // the first load seeds silently. One chime per batch (on its last row).
      const { watermark: next, alerts } = rowAlerts(watermark.current, d.items as (Item & AlertRow)[])
      watermark.current = next
      const ctx = { openCid: openCidRef.current, focused: document.hasFocus() }
      const due = alerts.filter((it) => shouldAlertRow(it, ctx))
      due.forEach((it, i) => raiseAlert({
        title: notificationTitle(it.type),
        body: typeof it.payload?.message === 'string' ? it.payload.message : '',
        tag: `notif:${it.type}`,
        url: notificationHref(it) ?? '/',
      }, { chime: i === due.length - 1 }))
    } catch { /* transient network error; next poll retries */ }
  }, [raiseAlert])

  useEffect(() => {
    // Fetch-on-mount: load() is async and only setStates after an awaited network
    // round-trip, so it can't cause the synchronous cascading render this rule guards against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    const t = setInterval(load, 30_000) // spec: 30 s polling — badge refresh + row alerts (W20-C)
    return () => clearInterval(t)
  }, [load])

  // Slack-like coverage (D5, Task 8): every inbound `msg` in an unmuted,
  // non-open conversation alerts — no burst throttle, so each qualifying
  // message funnels. useEvents re-reads this closure every render, so the
  // store conversations / selfId / openCid are live. The `msg` event carries
  // only {cid, mid}, so the message is fetched (the MessagePane precedent) —
  // skipped entirely when the open+focused conversation would suppress anyway.
  // Bot posts never alert here (shouldPingFromMessage) — a bot DM's bell row alerts through load() instead (W20-C).
  useEvents((e) => {
    if (e.t === 'notif' || e.t === 'reconnect') { void load(); return }
    if (e.t !== 'msg' || !('cid' in e)) return
    const cid = e.cid
    const conv = conversations.find((c) => c.id === cid)
    if (!conv || conv.muted) return
    if (openCid === cid && document.hasFocus()) return
    void fetch(`/api/chat/messages/${e.mid}`).then(async (r) => {
      if (!r.ok) return
      // MessageDto.body is `string` (empty for attachment-only/deleted rows,
      // never null) — hence `||` for the '(attachment)' fallback (fanout parity).
      const d = (await r.json()) as { message: { author: { id: string }; kind: string; body: string } }
      if (shouldPingFromMessage(
        { cid, authorId: d.message.author.id, kind: d.message.kind, muted: false },
        { openCid, focused: document.hasFocus(), selfId },
      )) {
        // Slack-shaped toast text (fanout parity): DM -> sender name,
        // channel -> #name; body "sender: preview". Sender name comes from
        // the chat store (the thin {cid,mid} SSE event never carries it);
        // the preview resolves mention tokens with the chat store too,
        // mirroring fanout's renderBody.
        const senderName = users.find((u) => u.id === d.message.author.id)?.name ?? 'Someone'
        const title = conv.type === 'DM' ? senderName : `#${conv.name ?? 'channel'}`
        const names = new Map(users.map((u) => [u.id, u.name]))
        const bodyText = renderBody(d.message.body || '(attachment)', names).slice(0, 120)
        const body = `${senderName}: ${bodyText}`
        raiseAlert({ title, body, tag: cid, url: `/chat/${cid}` })
      }
    })
  })

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && unread > 0) {
      const ids = items.filter((i) => !i.readAt).map((i) => i.id)
      await fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
      setUnread(0)
    }
  }

  // Resolve the actor face: a DM's peer shows their avatar; a channel shows its
  // hash; everything else falls back to a per-type glyph square.
  function faceFor(item: Item): Face {
    const cid = item.payload?.conversationId
    const conv = cid ? conversations.find((c) => c.id === cid) : undefined
    if (conv?.type === 'DM') {
      const peerId = conv.memberIds.find((id) => id !== selfId)
      if (peerId) {
        const peer = users.find((u) => u.id === peerId)
        return { kind: 'user', id: peerId, name: peer?.name ?? 'Someone', image: peer?.image ?? null }
      }
    }
    if (conv?.type === 'CHANNEL') return { kind: 'glyph', icon: Hash }
    return { kind: 'glyph', icon: TYPE_ICON[item.type] ?? BellIcon }
  }

  const groups = groupItems(items)

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle} aria-label="Notifications" className="relative rounded-full p-2 text-muted transition-colors hover:bg-hover hover:text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
        <BellIcon size={20} aria-hidden />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-on">{unread}</span>}
        {notifyAttention && <span aria-hidden className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-500" />}
      </button>
      {open && (
        // Pinned-footer tray (W12-A): the "Set up notifications" / "Install app"
        // rows used to sit at the bottom of ONE scroll container, so a full
        // notification list buried them below the fold. Sidebar bounded-scroller
        // idiom instead: flex column, the list alone scrolls (min-h-0 flex-1
        // overflow-y-auto), and the setup sections stay pinned in a shrink-0
        // footer that no list length can push out of view.
        <div className="absolute right-0 z-20 mt-2 flex max-h-[70vh] w-80 flex-col rounded-xl border border-border bg-surface shadow-menu">
          <p className="shrink-0 px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-subtle">Notifications</p>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {groups.length === 0 ? (
              <EmptyState icon={Check} title="You're all caught up."
                hint="New mentions, messages and booking updates will show up here." />
            ) : groups.map((g) => {
              const head = g.items[0]
              const face = faceFor(head)
              const unreadGroup = g.items.some((it) => !it.readAt)
              // Every notification type resolves to its target: issue → /issues/<id>,
              // DM/mention/channel → the conversation (deep-linked to the message when
              // known), booking → its bookings/approvals page. Grouping only merges
              // same-conversation rows, so the head is representative of the group.
              const href = notificationHref(head)
              const inner = (
                <>
                  <FaceAvatar face={face} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className={`truncate text-sm ${unreadGroup ? 'font-semibold text-default' : 'text-muted'}`}>{NOTIFICATION_LABEL[head.type] ?? head.type}</p>
                      <time className="shrink-0 text-2xs text-subtle">{humanTime(head.createdAt, now)}</time>
                    </div>
                    {g.items.map((it) => (
                      typeof it.payload?.message === 'string'
                        ? <p key={it.id} className="mt-0.5 line-clamp-2 text-xs text-muted">{it.payload.message}</p>
                        : null
                    ))}
                  </div>
                </>
              )
              return href ? (
                // Close the tray on navigate — the outside-click guard skips in-panel
                // clicks, so without this the panel would sit on top of the target page.
                <Link key={g.key} href={href} onClick={() => setOpen(false)} className="flex gap-2.5 rounded-lg p-2 transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">{inner}</Link>
              ) : (
                <div key={g.key} className="flex gap-2.5 rounded-lg p-2 transition-colors hover:bg-hover">{inner}</div>
              )
            })}
          </div>
          {(notifyAttention || install.show) && (
            <div className="shrink-0 p-2 pt-1">
              {notifyAttention && (
                <div className="mt-1 border-t border-border pt-1">
                  <button type="button" onClick={() => setWizardOpen(true)}
                    className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-avatar)] bg-active text-muted">
                      <BellPlus size={18} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-default">Set up notifications</span>
                      <span className="block text-xs text-subtle">Get sounds and alerts on your devices.</span>
                    </span>
                  </button>
                </div>
              )}
              {install.show && (
                // PWA install affordance: Chromium fires the native sheet; iOS has
                // no prompt event, so the row expands a Share → Add to Home Screen
                // guide. Never nested buttons — dismiss is a sibling, not a child.
                <div className="mt-1 border-t border-border pt-1">
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => (install.isIos ? install.openGuide() : void install.promptInstall())}
                      aria-expanded={install.isIos ? install.guideOpen : undefined}
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-avatar)] bg-active text-muted">
                        <Smartphone size={18} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-default">Install app</span>
                        <span className="block text-xs text-subtle">Add LabHub to your home screen.</span>
                      </span>
                    </button>
                    {!install.isIos && (
                      <button type="button" onClick={install.dismiss} aria-label="Dismiss install prompt"
                        className="rounded p-1 text-subtle hover:bg-hover hover:text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
                        <X size={16} aria-hidden />
                      </button>
                    )}
                  </div>
                  {install.guideOpen && (
                    <div className="px-2 pb-2 pt-1 text-xs text-muted">
                      <p>On iPhone or iPad:</p>
                      <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                        <li>Tap <span className="text-default">Share</span> (the square with an arrow) in the toolbar.</li>
                        <li>Scroll down and tap <span className="text-default">Add to Home Screen</span>.</li>
                        <li>Open LabHub from the home screen, then enable notifications from this bell.</li>
                      </ol>
                      <button type="button" onClick={install.dismiss}
                        className="mt-2 rounded px-2 py-1 text-xs font-medium text-accent hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
                        Got it
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <NotificationWizard open={wizardOpen} onClose={closeWizard} />
    </div>
  )
}

// Actor square: a real 36px avatar for a person, else a matching rounded-square
// glyph. Never a circle — same avatar radius as the rest of the app.
function FaceAvatar({ face }: { face: Face }) {
  if (face.kind === 'user') return <Avatar size={36} name={face.name} id={face.id} image={face.image} />
  const Icon = face.icon
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-avatar)] bg-active text-muted">
      <Icon size={18} aria-hidden />
    </span>
  )
}
