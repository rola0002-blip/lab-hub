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

type ChipArgs = Parameters<typeof statusChip>[0]

// Which band of the /booking catalogue an instrument falls into for this viewer.
// Derived from statusChip's own BRANCHES, never from its label, and byte-for-byte
// the policy.ts:37 predicate — so the catalogue can never promise a booking the API
// would block. Needing approval is NOT being blocked, so it stays 'available'.
export type CatalogueSection = 'available' | 'certification' | 'retired'

export function catalogueSection(args: ChipArgs): CatalogueSection {
  const { equipment: eq } = args
  if (eq.status === 'RETIRED') return 'retired'
  if (eq.certificationRequired && !args.isCertified) return 'certification'
  return 'available'
}

// Order-preserving three-way split. Shape choice: a `toArgs` projection rather than
// an `{ args, item }` wrapper, so the page hands its rows straight in and gets rows
// straight back — one call, nothing to map in, nothing to unwrap in the JSX, and no
// reduce/filter left on the page.
export function partitionCatalogue<T>(items: T[], toArgs: (item: T) => ChipArgs): { available: T[]; certification: T[]; retired: T[] } {
  const out: { available: T[]; certification: T[]; retired: T[] } = { available: [], certification: [], retired: [] }
  for (const item of items) out[catalogueSection(toArgs(item))].push(item)
  return out
}
