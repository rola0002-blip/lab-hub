import { describe, it, expect } from 'vitest'
import {
  SESSION_EARLY_MS, SESSION_LATE_MS,
  sessionPhase, canStartSession, canEndSession, type SessionInput,
} from './session'

// Fixed slot 10:00–11:00Z; every `now` below is derived from these instants.
const T0 = new Date('2026-09-05T10:00:00Z').getTime()
const T1 = new Date('2026-09-05T11:00:00Z').getTime()
const at = (offsetMs: number) => new Date(T0 + offsetMs)

const base = (): SessionInput => ({
  status: 'CONFIRMED',
  startsAt: new Date(T0),
  endsAt: new Date(T1),
  sessionStartedAt: null,
  sessionEndedAt: null,
})

describe('canStartSession (owner windows)', () => {
  it('allows at exactly startsAt − 15min', () => {
    expect(canStartSession(base(), at(-SESSION_EARLY_MS), { manager: false })).toEqual({ ok: true })
  })

  it('rejects 1ms before the early boundary with the exact message', () => {
    const v = canStartSession(base(), at(-SESSION_EARLY_MS - 1), { manager: false })
    expect(v).toEqual({ ok: false, message: 'Log-on opens 15 minutes before your booked slot.' })
  })

  it('allows at exactly endsAt', () => {
    expect(canStartSession(base(), new Date(T1), { manager: false })).toEqual({ ok: true })
  })

  it('rejects 1ms after endsAt with the exact message', () => {
    const v = canStartSession(base(), new Date(T1 + 1), { manager: false })
    expect(v).toEqual({ ok: false, message: 'This booking slot has already ended.' })
  })

  it('allows mid-slot', () => {
    expect(canStartSession(base(), at(30 * 60_000), { manager: false })).toEqual({ ok: true })
  })
})

describe('canEndSession (owner window)', () => {
  const started = (): SessionInput => ({ ...base(), sessionStartedAt: new Date(T0) })

  it('allows at exactly endsAt + 30min', () => {
    expect(canEndSession(started(), new Date(T1 + SESSION_LATE_MS), { manager: false })).toEqual({ ok: true })
  })

  it('rejects 1ms after the late boundary with the exact message', () => {
    const v = canEndSession(started(), new Date(T1 + SESSION_LATE_MS + 1), { manager: false })
    expect(v).toEqual({ ok: false, message: 'The log-off window (30 minutes after the slot) has closed — ask a manager to correct it.' })
  })
})

describe('manager bypass (windows only, never the state machine)', () => {
  it('manager may start arbitrarily early and end arbitrarily late', () => {
    const b = base()
    expect(canStartSession(b, at(-24 * 3_600_000), { manager: true })).toEqual({ ok: true })
    const started = { ...b, sessionStartedAt: new Date(T0) }
    expect(canEndSession(started, new Date(T1 + 365 * 24 * 3_600_000), { manager: true })).toEqual({ ok: true })
  })

  it('manager is still rejected on double-start', () => {
    const v = canStartSession({ ...base(), sessionStartedAt: new Date(T0) }, at(0), { manager: true })
    expect(v).toEqual({ ok: false, message: 'This session was already logged on.' })
  })

  it('manager is still rejected on end-without-start', () => {
    const v = canEndSession(base(), at(0), { manager: true })
    expect(v).toEqual({ ok: false, message: 'Log on before logging off.' })
  })

  it('manager start still gated on CONFIRMED; manager may close a session on a post-start-cancelled booking', () => {
    const v = canStartSession({ ...base(), status: 'PENDING' }, at(0), { manager: true })
    expect(v).toEqual({ ok: false, message: 'Sessions can only be logged on confirmed bookings.' })
    const ve = canEndSession({ ...base(), status: 'CANCELLED', sessionStartedAt: new Date(T0) }, at(0), { manager: true })
    expect(ve).toEqual({ ok: true })
  })
})

describe('state machine', () => {
  it('PENDING start rejected', () => {
    const v = canStartSession({ ...base(), status: 'PENDING' }, at(0), { manager: false })
    expect(v).toEqual({ ok: false, message: 'Sessions can only be logged on confirmed bookings.' })
  })

  it('started → start rejected with the exact message', () => {
    const v = canStartSession({ ...base(), sessionStartedAt: new Date(T0) }, at(0), { manager: false })
    expect(v).toEqual({ ok: false, message: 'This session was already logged on.' })
  })

  it('ended → start rejected (ended check precedes started)', () => {
    const v = canStartSession({ ...base(), sessionStartedAt: new Date(T0), sessionEndedAt: new Date(T1) }, at(0), { manager: false })
    expect(v).toEqual({ ok: false, message: 'This session was already logged off.' })
  })

  it('ended → end rejected', () => {
    const v = canEndSession({ ...base(), sessionStartedAt: new Date(T0), sessionEndedAt: new Date(T1) }, at(0), { manager: false })
    expect(v).toEqual({ ok: false, message: 'This session was already logged off.' })
  })

  it('owner end-without-start rejected even mid-slot', () => {
    const v = canEndSession(base(), at(0), { manager: false })
    expect(v).toEqual({ ok: false, message: 'Log on before logging off.' })
  })
})

describe('sessionPhase', () => {
  it('none / active / ended', () => {
    expect(sessionPhase(base())).toBe('none')
    expect(sessionPhase({ ...base(), sessionStartedAt: new Date(T0) })).toBe('active')
    expect(sessionPhase({ ...base(), sessionStartedAt: new Date(T0), sessionEndedAt: new Date(T1) })).toBe('ended')
  })
})

describe('ISO-string inputs (the DTO passes strings)', () => {
  it('behaves identically to Date inputs on every boundary', () => {
    const iso = (): SessionInput => ({
      status: 'CONFIRMED',
      startsAt: new Date(T0).toISOString(),
      endsAt: new Date(T1).toISOString(),
      sessionStartedAt: null,
      sessionEndedAt: null,
    })
    expect(canStartSession(iso(), at(-SESSION_EARLY_MS), { manager: false })).toEqual({ ok: true })
    const early = canStartSession(iso(), at(-SESSION_EARLY_MS - 1), { manager: false })
    expect(early).toEqual({ ok: false, message: 'Log-on opens 15 minutes before your booked slot.' })
    const past = canStartSession(iso(), new Date(T1 + 1), { manager: false })
    expect(past).toEqual({ ok: false, message: 'This booking slot has already ended.' })
    const started = { ...iso(), sessionStartedAt: new Date(T0).toISOString() }
    expect(canEndSession(started, new Date(T1 + SESSION_LATE_MS), { manager: false })).toEqual({ ok: true })
    const closed = canEndSession(started, new Date(T1 + SESSION_LATE_MS + 1), { manager: false })
    expect(closed).toEqual({ ok: false, message: 'The log-off window (30 minutes after the slot) has closed — ask a manager to correct it.' })
    expect(sessionPhase({ ...iso(), sessionStartedAt: new Date(T0).toISOString() })).toBe('active')
    expect(sessionPhase({ ...iso(), sessionStartedAt: new Date(T0).toISOString(), sessionEndedAt: new Date(T1).toISOString() })).toBe('ended')
  })
})
