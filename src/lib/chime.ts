// Which bell rows chime: chat-shaped notifications only (F7). The notif SSE
// event carries no type, so the client diffs fetched items against a watermark.
export const CHIME_TYPES = new Set(['message_mention', 'message_dm', 'message_thread_reply'])
export type ChimeItem = { id: string; type: string; createdAt: string }

// Returns the advanced watermark, whether to chime, and the rows that triggered
// it (`hits`, in batch order — the poll delivers newest-first). First run (null
// watermark) initializes WITHOUT chiming — opening the app must not ding.
// `hits` feeds the desktop-shell notification bridge (SP11): the toast must
// surface exactly the rows the chime did, so it rides the same decision.
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

// One ping per burst: a hit inside the window is swallowed (NO queued backlog
// ping — Slack dings once per burst, it does not replay the queue).
export class PingThrottle {
  private last = 0
  constructor(private readonly minIntervalMs = 3000) {}
  canPing(now = Date.now()): boolean {
    if (now - this.last < this.minIntervalMs) return false
    this.last = now
    return true
  }
}

// 2026-09 notifications: where the SOUND lives. In the desktop shell the
// native toast carries an OS sound, so the in-page WebAudio chime is
// suppressed (no double-ding); browsers/PWA keep the chime. Shell toasts
// render regardless of the per-device sound toggle — the toggle sets the
// toast's `silent` flag rather than hiding the toast.
export function alertRendering(inShell: boolean): { chime: boolean; toast: boolean } {
  return { chime: !inShell, toast: inShell }
}
