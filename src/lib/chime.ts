import { COLOSSUS_BOT_ID } from '@/features/bot/ids'

// The chat-shaped bell row types. These rows do NOT alert from the row: a human
// message already alerted through the realtime msg path (client) and fanout's
// push (server) the moment it landed.
export const CHAT_ROW_TYPES = new Set(['message_mention', 'message_dm', 'message_thread_reply'])

export type AlertRow = { id: string; type: string; createdAt: string; payload?: Record<string, unknown> | null }

// W20-C: which bell rows raise their OWN pop-out — the single predicate the bell
// (in-app popup) and notify() (idle push) share, so the two can never disagree.
// Every non-chat row alerts; a chat row alerts only when the BOT sent it (the
// issue due-soon/overdue DMs), because bot messages never alert through the msg
// path (shouldPingFromMessage below) or fanout's push (senderIsBot).
export function isRowAlertable(row: Pick<AlertRow, 'type' | 'payload'>): boolean {
  if (!CHAT_ROW_TYPES.has(row.type)) return true
  return row.payload?.senderId === COLOSSUS_BOT_ID
}

// A reconnect after sleep can surface a backlog, and the bell — not a wall of
// popups — is where a backlog belongs: at most MAX_ROW_ALERTS pop out per load
// (the newest win), and rows older than ROW_ALERT_MAX_AGE_MS (by server
// createdAt) only refresh the badge. A client clock running >15 min fast
// silences row pop-outs (the badge still counts) — accepted.
export const MAX_ROW_ALERTS = 3
export const ROW_ALERT_MAX_AGE_MS = 15 * 60_000

// The bell's per-load diff (W20-C; replaces the old shouldChime). The watermark
// advances past EVERY row seen; the alerts are the alertable rows newer than the
// ORIGINAL watermark (a newer row in a newest-first batch must not shadow an older
// unseen one), fresh enough, oldest-first, capped. First run (null watermark)
// seeds silently — opening the app never pops a backlog. Every load trigger (30 s
// poll, notif, reconnect) may alert; the watermark makes each row alert once.
export function rowAlerts<T extends AlertRow>(
  watermark: string | null, items: T[], now: number = Date.now(),
): { watermark: string; alerts: T[] } {
  let max = watermark
  const fresh: T[] = []
  for (const it of items) {
    if (watermark !== null && it.createdAt > watermark && isRowAlertable(it)
      && now - Date.parse(it.createdAt) <= ROW_ALERT_MAX_AGE_MS) fresh.push(it)
    if (it.createdAt > (max ?? '')) max = it.createdAt
  }
  fresh.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
  return { watermark: max ?? '', alerts: fresh.slice(-MAX_ROW_ALERTS) }
}

// A row about the conversation you are reading (the bot DM a reminder or a
// due-soon ping rides in) stays quiet while the window is focused — the msg
// path's open+focused rule, applied to rows.
export function shouldAlertRow(
  row: Pick<AlertRow, 'payload'>, opts: { openCid: string | null; focused: boolean },
): boolean {
  const cid = row.payload?.conversationId
  return !(opts.focused && typeof cid === 'string' && cid === opts.openCid)
}

// Wave 9 (D5/D7): Slack-like coverage — every new message in an unmuted,
// non-open conversation pings. The SSE `msg` event carries only {cid, mid}, so
// the Bell fetches the message (the MessagePane precedent) and decides HERE.
export type MsgPingInput = { cid: string; authorId: string; kind?: string; muted: boolean }

export function shouldPingFromMessage(
  m: MsgPingInput,
  opts: { openCid: string | null; focused: boolean; selfId: string },
): boolean {
  if (m.muted) return false
  if (m.kind === 'system') return false
  // W20-C: bot posts never alert here — a bot DM's paired bell row is its alert
  // (rowAlerts), and #lab-updates announcements are FYI. This is the documented
  // "Bot posts never alert" contract fanout's push already keeps.
  if (m.authorId === COLOSSUS_BOT_ID) return false
  if (m.authorId === opts.selfId) return false // never ping your own echo
  if (opts.focused && m.cid === opts.openCid) return false // you are looking at it
  return true
}

// 2026-09 notifications: where the SOUND lives. In the desktop shell the
// native toast carries an OS sound, so the in-page WebAudio chime is
// suppressed (no double-ding); browsers/PWA keep the chime. Shell toasts
// render regardless of the per-device sound toggle — the toggle sets the
// toast's `silent` flag rather than hiding the toast.
export function alertRendering(inShell: boolean): { chime: boolean; toast: boolean } {
  return { chime: !inShell, toast: inShell }
}

// Task 8 (v0.32.0): the consolidated alert decision for ONE message. The SSE
// msg path calls this for EVERY qualifying inbound message — the old 3 s
// PingThrottle is gone ("whenever there are new messages"), so the decision
// is pure and stateless: two qualifying messages 1 ms apart both alert.
// `popup` (Task 9) is the browser OS-popup arm: on for browsers/PWA, never
// in the desktop shell (the shell's own native toast is the popup there).
// `swPopup` routes standalone mobile PWAs (iOS 16.4+, Android Chrome)
// through registration.showNotification — those platforms throw on the
// page-context Notification constructor, so the SW is the only OS surface.
// Permission + per-device pref are environment concerns — the funnel gates
// on them at fire time, keeping this pure.
export function decideAlert(
  msgQualifies: boolean,
  inShell: boolean,
  inStandalone = false,
): { chime: boolean; toast: boolean; popup: boolean; swPopup: boolean } {
  if (!msgQualifies) return { chime: false, toast: false, popup: false, swPopup: false }
  const { chime, toast } = alertRendering(inShell)
  return { chime, toast, popup: !inShell && !inStandalone, swPopup: !inShell && inStandalone }
}
