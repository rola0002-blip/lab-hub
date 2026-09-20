// Which bell rows chime: chat-shaped notifications only (F7). The notif SSE
// event carries no type, so the client diffs fetched items against a watermark.
export const CHIME_TYPES = new Set(['message_mention', 'message_dm', 'message_thread_reply'])
export type ChimeItem = { id: string; type: string; createdAt: string }

// Returns the advanced watermark, whether to chime, and the rows that would
// have triggered it (`hits`, in batch order — the poll delivers newest-first).
// First run (null watermark) initializes WITHOUT chiming — opening the app
// must not ding. Since Task 8 the bell consumes ONLY the watermark: the 30 s
// poll is a silent badge refresher (the SSE msg path is the single alert
// source), so `chime`/`hits` describe what the OLD path would have chimed —
// the contract is kept for the unit tests and any future consumer.
export function shouldChime(watermark: string | null, items: ChimeItem[]): { chime: boolean; watermark: string; hits: ChimeItem[] } {
  let max = watermark
  const hits: ChimeItem[] = []
  for (const it of items) {
    // Chime candidates compare against the ORIGINAL watermark (a newer
    // non-chat row in the same batch must not shadow them); the watermark
    // itself advances past everything seen.
    if (watermark !== null && it.createdAt > watermark && CHIME_TYPES.has(it.type)) hits.push(it)
    if (it.createdAt > (max ?? '')) max = it.createdAt
  }
  return { chime: hits.length > 0, watermark: max ?? '', hits }
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
// Permission + per-device pref are environment concerns — the funnel gates
// on them at fire time, keeping this pure.
export function decideAlert(msgQualifies: boolean, inShell: boolean): { chime: boolean; toast: boolean; popup: boolean } {
  if (!msgQualifies) return { chime: false, toast: false, popup: false }
  const { chime, toast } = alertRendering(inShell)
  return { chime, toast, popup: !inShell }
}
