export type Chip = { label: 'Book instantly' | 'Approval needed' | 'Certification required' | 'Retired'; tone: 'green' | 'amber' | 'red' | 'gray' }

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
