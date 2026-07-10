export type Chip = { label: 'Book instantly' | 'Approval needed' | 'Certification required' | 'Retired'; tone: 'green' | 'amber' | 'red' | 'gray' }

// Booking.status → <Badge variant>. Name + shape are a contract: Task 17 imports this verbatim.
export const BOOKING_VARIANT = { CONFIRMED: 'success', PENDING: 'warning', REJECTED: 'danger', CANCELLED: 'neutral', EXPIRED: 'neutral' } as const

// Equipment statusChip tone → <Badge variant>. Preserves the four-way distinction
// (block=danger vs approval=warning) the chip module already encodes.
export const CHIP_VARIANT = { green: 'success', amber: 'warning', red: 'danger', gray: 'neutral' } as const

export function statusChip(args: {
  role: 'admin' | 'member' | 'guest'
  isCertified: boolean
  equipment: { status: 'ACTIVE' | 'RETIRED'; certificationRequired: boolean; approvalPolicy: 'NONE' | 'GUESTS' | 'ALL' }
}): Chip {
  const { equipment: eq } = args
  if (eq.status === 'RETIRED') return { label: 'Retired', tone: 'gray' }
  if (eq.certificationRequired && !args.isCertified) return { label: 'Certification required', tone: 'red' }
  if (eq.approvalPolicy === 'ALL' || (eq.approvalPolicy === 'GUESTS' && args.role === 'guest')) return { label: 'Approval needed', tone: 'amber' }
  return { label: 'Book instantly', tone: 'green' }
}
