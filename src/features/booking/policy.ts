export type Role = 'admin' | 'member' | 'guest'
export type BlockReason =
  | 'invalid_range' | 'in_past' | 'retired' | 'certification_required'
  | 'recurring_not_allowed' | 'advance_window' | 'max_duration' | 'maintenance_overlap'
export type Verdict =
  | { kind: 'blocked'; reason: BlockReason; message: string }
  | { kind: 'instant' }
  | { kind: 'approval'; why: 'guest_policy' | 'all_policy' }

export interface PolicyInput {
  now: Date
  role: Role
  isManager: boolean
  isCertified: boolean
  equipment: {
    status: 'ACTIVE' | 'RETIRED'
    advanceBookingDays: number
    maxDurationMinutes: number
    certificationRequired: boolean
    approvalPolicy: 'NONE' | 'GUESTS' | 'ALL'
    allowRecurring: boolean
  }
  slot: { startsAt: Date; endsAt: Date }
  recurring: boolean
  maintenance: Array<{ startsAt: Date; endsAt: Date }>
}

const blocked = (reason: BlockReason, message: string): Verdict => ({ kind: 'blocked', reason, message })

export function evaluateBooking(i: PolicyInput): Verdict {
  const { slot, equipment: eq } = i
  const durationMin = (slot.endsAt.getTime() - slot.startsAt.getTime()) / 60_000

  if (durationMin <= 0) return blocked('invalid_range', 'End time must be after start time.')
  if (slot.startsAt < i.now) return blocked('in_past', 'Bookings must start in the future.')
  if (eq.status === 'RETIRED') return blocked('retired', 'This instrument has been retired.')
  if (eq.certificationRequired && !i.isCertified)
    return blocked('certification_required', 'You must be certified on this instrument before booking. Ask an equipment manager.')
  if (i.recurring && !eq.allowRecurring)
    return blocked('recurring_not_allowed', 'This instrument does not allow recurring bookings.')
  // Recurring requests skip the advance window: a manager approves the whole series (spec §6.4).
  if (!i.recurring && !i.isManager) {
    const horizon = new Date(i.now.getTime() + eq.advanceBookingDays * 86_400_000)
    if (slot.startsAt > horizon)
      return blocked('advance_window', `Bookings can be made at most ${eq.advanceBookingDays} days in advance on this instrument.`)
  }
  if (!i.isManager && durationMin > eq.maxDurationMinutes)
    return blocked('max_duration', `Maximum booking length on this instrument is ${eq.maxDurationMinutes / 60} hours.`)
  const clash = i.maintenance.some((m) => m.startsAt < slot.endsAt && m.endsAt > slot.startsAt)
  if (clash) return blocked('maintenance_overlap', 'The requested time overlaps scheduled maintenance.')

  if (eq.approvalPolicy === 'ALL') return { kind: 'approval', why: 'all_policy' }
  if (eq.approvalPolicy === 'GUESTS' && i.role === 'guest') return { kind: 'approval', why: 'guest_policy' }
  return { kind: 'instant' }
}
