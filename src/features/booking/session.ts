// W12-C: usage-session windows — pure + CLIENT-SAFE (the policy.ts posture; the
// bookings client imports SESSION_LATE_MS for loose button visibility). Windows are
// absolute-instant math (the advance-window precedent); managers bypass WINDOWS
// only, never the state machine (settled D3). Start owns the CONFIRMED gate; a
// factually-started session stays closeable even after a post-start cancel.
export const SESSION_EARLY_MS = 15 * 60_000
export const SESSION_LATE_MS = 30 * 60_000

export type SessionInput = {
  status: string
  startsAt: Date | string
  endsAt: Date | string
  sessionStartedAt?: Date | string | null
  sessionEndedAt?: Date | string | null
}
const ms = (v: Date | string) => new Date(v).getTime()

export type SessionPhase = 'none' | 'active' | 'ended'
export function sessionPhase(b: SessionInput): SessionPhase {
  if (b.sessionEndedAt) return 'ended'
  if (b.sessionStartedAt) return 'active'
  return 'none'
}

export type SessionVerdict = { ok: true } | { ok: false; message: string }

export function canStartSession(b: SessionInput, now: Date, opts: { manager: boolean }): SessionVerdict {
  if (b.status !== 'CONFIRMED') return { ok: false, message: 'Sessions can only be logged on confirmed bookings.' }
  if (b.sessionEndedAt) return { ok: false, message: 'This session was already logged off.' }
  if (b.sessionStartedAt) return { ok: false, message: 'This session was already logged on.' }
  if (!opts.manager) {
    if (now.getTime() < ms(b.startsAt) - SESSION_EARLY_MS) return { ok: false, message: 'Log-on opens 15 minutes before your booked slot.' }
    if (now.getTime() > ms(b.endsAt)) return { ok: false, message: 'This booking slot has already ended.' }
  }
  return { ok: true }
}

export function canEndSession(b: SessionInput, now: Date, opts: { manager: boolean }): SessionVerdict {
  if (!b.sessionStartedAt) return { ok: false, message: 'Log on before logging off.' }
  if (b.sessionEndedAt) return { ok: false, message: 'This session was already logged off.' }
  if (!opts.manager && now.getTime() > ms(b.endsAt) + SESSION_LATE_MS) {
    return { ok: false, message: 'The log-off window (30 minutes after the slot) has closed — ask a manager to correct it.' }
  }
  return { ok: true }
}
