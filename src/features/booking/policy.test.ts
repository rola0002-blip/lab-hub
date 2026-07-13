import { describe, it, expect } from 'vitest'
import { evaluateBooking, type PolicyInput } from './policy'

const NOW = new Date('2026-07-07T04:00:00Z')
const h = (n: number) => new Date(NOW.getTime() + n * 3_600_000)

function input(over: Partial<PolicyInput> & { eq?: Partial<PolicyInput['equipment']>; slot?: PolicyInput['slot'] } = {}): PolicyInput {
  const { eq, ...rest } = over
  return {
    now: NOW, role: 'member', isManager: false, isCertified: false,
    equipment: {
      status: 'ACTIVE', advanceBookingDays: 14, maxDurationMinutes: 480,
      certificationRequired: false, approvalPolicy: 'GUESTS', allowRecurring: false, ...eq,
    },
    slot: { startsAt: h(24), endsAt: h(28) },
    recurring: false, maintenance: [],
    ...rest,
  }
}

describe('evaluateBooking — blocking rules', () => {
  it('rejects end <= start', () => {
    const v = evaluateBooking(input({ slot: { startsAt: h(2), endsAt: h(2) } }))
    expect(v).toMatchObject({ kind: 'blocked', reason: 'invalid_range' })
  })
  it('rejects a start in the past', () => {
    const v = evaluateBooking(input({ slot: { startsAt: h(-1), endsAt: h(1) } }))
    expect(v).toMatchObject({ kind: 'blocked', reason: 'in_past' })
  })
  it('rejects retired equipment for everyone including admins', () => {
    const v = evaluateBooking(input({ role: 'admin', isManager: true, eq: { status: 'RETIRED' } }))
    expect(v).toMatchObject({ kind: 'blocked', reason: 'retired' })
  })
  it('blocks uncertified users (any role, even managers) when certification is required', () => {
    for (const [role, isManager] of [['guest', false], ['member', false], ['admin', true]] as const) {
      const v = evaluateBooking(input({ role, isManager, eq: { certificationRequired: true } }))
      expect(v).toMatchObject({ kind: 'blocked', reason: 'certification_required' })
    }
  })
  it('allows certified users past the certification gate', () => {
    const v = evaluateBooking(input({ isCertified: true, eq: { certificationRequired: true, approvalPolicy: 'NONE' } }))
    expect(v).toEqual({ kind: 'instant' })
  })
  it('blocks recurring on instruments that disallow it', () => {
    const v = evaluateBooking(input({ recurring: true, eq: { allowRecurring: false } }))
    expect(v).toMatchObject({ kind: 'blocked', reason: 'recurring_not_allowed' })
  })
  it('enforces the advance window for non-managers with the day count in the message', () => {
    const v = evaluateBooking(input({ slot: { startsAt: h(15 * 24), endsAt: h(15 * 24 + 2) } }))
    expect(v).toMatchObject({ kind: 'blocked', reason: 'advance_window' })
    if (v.kind === 'blocked') expect(v.message).toContain('14')
  })
  it('managers and admins bypass the advance window', () => {
    const slot = { startsAt: h(30 * 24), endsAt: h(30 * 24 + 2) }
    expect(evaluateBooking(input({ isManager: true, slot }))).toEqual({ kind: 'instant' })
  })
  it('enforces max duration for non-managers; managers bypass', () => {
    const slot = { startsAt: h(24), endsAt: h(24 + 9) } // 9h > 480min
    expect(evaluateBooking(input({ slot }))).toMatchObject({ kind: 'blocked', reason: 'max_duration' })
    expect(evaluateBooking(input({ isManager: true, slot }))).toEqual({ kind: 'instant' })
  })
  it('blocks overlap with a maintenance window (all roles)', () => {
    const maintenance = [{ startsAt: h(25), endsAt: h(26) }]
    expect(evaluateBooking(input({ maintenance }))).toMatchObject({ kind: 'blocked', reason: 'maintenance_overlap' })
    expect(evaluateBooking(input({ isManager: true, maintenance }))).toMatchObject({ kind: 'blocked', reason: 'maintenance_overlap' })
  })
  it('does not block for adjacent (non-overlapping) maintenance', () => {
    const maintenance = [{ startsAt: h(28), endsAt: h(30) }] // touches endsAt exactly
    expect(evaluateBooking(input({ maintenance }))).toEqual({ kind: 'instant' })
  })
})

describe('evaluateBooking — approval routing', () => {
  it('NONE policy: everyone books instantly', () => {
    for (const role of ['guest', 'member', 'admin'] as const) {
      expect(evaluateBooking(input({ role, eq: { approvalPolicy: 'NONE' } }))).toEqual({ kind: 'instant' })
    }
  })
  it('GUESTS policy: guests need approval, members/admins do not', () => {
    expect(evaluateBooking(input({ role: 'guest' }))).toEqual({ kind: 'approval', why: 'guest_policy' })
    expect(evaluateBooking(input({ role: 'member' }))).toEqual({ kind: 'instant' })
    expect(evaluateBooking(input({ role: 'admin', isManager: true }))).toEqual({ kind: 'instant' })
  })
  it('ALL policy: everyone queues, including managers (spec §6.2)', () => {
    expect(evaluateBooking(input({ role: 'admin', isManager: true, eq: { approvalPolicy: 'ALL' } }))).toEqual({ kind: 'approval', why: 'all_policy' })
  })
  it('certified guest on certification-required + GUESTS policy → approval (spec §6.1 table)', () => {
    const v = evaluateBooking(input({ role: 'guest', isCertified: true, eq: { certificationRequired: true } }))
    expect(v).toEqual({ kind: 'approval', why: 'guest_policy' })
  })
})

describe('evaluateBooking — edge-semantics pins', () => {
  it('managers do NOT bypass the recurring-not-allowed rule', () => {
    const v = evaluateBooking(input({ role: 'admin', isManager: true, recurring: true, eq: { allowRecurring: false } }))
    expect(v).toMatchObject({ kind: 'blocked', reason: 'recurring_not_allowed' })
  })
  it('retired is checked before recurring, so retired wins', () => {
    const v = evaluateBooking(input({ recurring: true, eq: { status: 'RETIRED', allowRecurring: false } }))
    expect(v).toMatchObject({ kind: 'blocked', reason: 'retired' })
  })
  it('blocks maintenance that fully contains the slot', () => {
    const maintenance = [{ startsAt: h(23), endsAt: h(29) }] // slot is h(24)-h(28)
    expect(evaluateBooking(input({ maintenance }))).toMatchObject({ kind: 'blocked', reason: 'maintenance_overlap' })
  })
  it('blocks maintenance strictly contained inside the slot', () => {
    const maintenance = [{ startsAt: h(25), endsAt: h(27) }]
    expect(evaluateBooking(input({ maintenance }))).toMatchObject({ kind: 'blocked', reason: 'maintenance_overlap' })
  })
  it('does not block maintenance that touches the slot start (m.endsAt === slot.startsAt)', () => {
    const maintenance = [{ startsAt: h(22), endsAt: h(24) }] // ends exactly at slot.startsAt
    expect(evaluateBooking(input({ maintenance }))).toEqual({ kind: 'instant' })
  })
  it('advance window: a slot at exactly the horizon is allowed, +1ms is blocked', () => {
    const horizon = NOW.getTime() + 14 * 86_400_000 // advanceBookingDays default is 14
    const dur = 2 * 3_600_000
    const atHorizon = { startsAt: new Date(horizon), endsAt: new Date(horizon + dur) }
    expect(evaluateBooking(input({ slot: atHorizon }))).toEqual({ kind: 'instant' })
    const overHorizon = { startsAt: new Date(horizon + 1), endsAt: new Date(horizon + 1 + dur) }
    expect(evaluateBooking(input({ slot: overHorizon }))).toMatchObject({ kind: 'blocked', reason: 'advance_window' })
  })
  it('in_past seam: a slot starting at exactly now is allowed (check is strict <)', () => {
    const v = evaluateBooking(input({ slot: { startsAt: NOW, endsAt: h(2) } }))
    expect(v).toEqual({ kind: 'instant' })
  })
})

describe('recurring follows the per-equipment policy (SP5 §3.4)', () => {
  it('NONE → instant for a recurring series', () => {
    expect(evaluateBooking(input({ recurring: true, eq: { allowRecurring: true, approvalPolicy: 'NONE' } })))
      .toEqual({ kind: 'instant' })
  })
  it('ALL → approval (all_policy) for a recurring series', () => {
    expect(evaluateBooking(input({ recurring: true, eq: { allowRecurring: true, approvalPolicy: 'ALL' } })))
      .toEqual({ kind: 'approval', why: 'all_policy' })
  })
  it('GUESTS + guest → approval (guest_policy); GUESTS + member → instant, even recurring', () => {
    expect(evaluateBooking(input({ recurring: true, role: 'guest', eq: { allowRecurring: true } })))
      .toEqual({ kind: 'approval', why: 'guest_policy' })
    expect(evaluateBooking(input({ recurring: true, role: 'member', eq: { allowRecurring: true } })))
      .toEqual({ kind: 'instant' })
  })
  it('allowRecurring=false still hard-blocks recurring before any approval routing', () => {
    expect(evaluateBooking(input({ recurring: true, eq: { allowRecurring: false } })))
      .toEqual({ kind: 'blocked', reason: 'recurring_not_allowed', message: 'This instrument does not allow recurring bookings.' })
  })
  it('advance window stays skipped for a recurring series (far-future first occurrence)', () => {
    const far = { startsAt: h(180 * 24), endsAt: h(180 * 24 + 1) }
    expect(evaluateBooking(input({ recurring: true, slot: far, eq: { allowRecurring: true, approvalPolicy: 'NONE' } })))
      .toEqual({ kind: 'instant' }) // not blocked by advance_window
  })
})
