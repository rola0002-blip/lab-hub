import { describe, it, expect } from 'vitest'
import { statusChip, catalogueSection, partitionCatalogue } from './chip'

const eq = (over = {}) => ({ status: 'ACTIVE' as const, certificationRequired: false, approvalPolicy: 'GUESTS' as const, ...over })

describe('statusChip', () => {
  it('member on GUESTS policy books instantly', () => {
    expect(statusChip({ role: 'member', isCertified: false, equipment: eq() }).label).toBe('Book instantly')
  })
  it('guest on GUESTS policy needs approval', () => {
    expect(statusChip({ role: 'guest', isCertified: false, equipment: eq() }).label).toBe('Approval needed')
  })
  it('uncertified user on cert-required instrument sees Certification required', () => {
    expect(statusChip({ role: 'member', isCertified: false, equipment: eq({ certificationRequired: true }) }).label).toBe('Certification required')
  })
  it('certified guest on cert-required + GUESTS still needs approval', () => {
    expect(statusChip({ role: 'guest', isCertified: true, equipment: eq({ certificationRequired: true }) }).label).toBe('Approval needed')
  })
  it('ALL policy needs approval for everyone; retired wins over everything', () => {
    expect(statusChip({ role: 'admin', isCertified: true, equipment: eq({ approvalPolicy: 'ALL' }) }).label).toBe('Approval needed')
    expect(statusChip({ role: 'admin', isCertified: true, equipment: eq({ status: 'RETIRED' }) }).label).toBe('Retired')
  })
})

// The catalogue's three sections come from statusChip's BRANCHES, never from its
// display label — a copy change to a chip must not silently reshuffle the page.
describe('catalogueSection', () => {
  it('RETIRED wins over certification', () => {
    expect(catalogueSection({ role: 'member', isCertified: false, equipment: { status: 'RETIRED', certificationRequired: true, approvalPolicy: 'NONE' } })).toBe('retired')
  })
  it('an uncertified admin is NOT exempt (policy.ts:37 has no role bypass)', () => {
    expect(catalogueSection({ role: 'admin', isCertified: false, equipment: { status: 'ACTIVE', certificationRequired: true, approvalPolicy: 'NONE' } })).toBe('certification')
  })
  it('a certified guest is available — needing approval is not being blocked', () => {
    expect(catalogueSection({ role: 'guest', isCertified: true, equipment: { status: 'ACTIVE', certificationRequired: true, approvalPolicy: 'ALL' } })).toBe('available')
  })
  it('an open instrument is available', () => {
    expect(catalogueSection({ role: 'member', isCertified: false, equipment: { status: 'ACTIVE', certificationRequired: false, approvalPolicy: 'NONE' } })).toBe('available')
  })
})

describe('partitionCatalogue', () => {
  type Row = { name: string; status: 'ACTIVE' | 'RETIRED'; certificationRequired: boolean }
  const toArgs = (r: Row) => ({
    role: 'member' as const,
    isCertified: false,
    equipment: { status: r.status, certificationRequired: r.certificationRequired, approvalPolicy: 'NONE' as const },
  })
  const row = (name: string, over: Partial<Row> = {}): Row => ({ name, status: 'ACTIVE', certificationRequired: false, ...over })

  it('splits three ways and preserves the incoming order inside each section', () => {
    const items = [
      row('AFM', { certificationRequired: true }),
      row('Optical bench'),
      row('Old sputterer', { status: 'RETIRED' }),
      row('Raman'),
      row('XPS', { certificationRequired: true }),
    ]
    const out = partitionCatalogue(items, toArgs)
    expect(out.available.map((r) => r.name)).toEqual(['Optical bench', 'Raman'])
    expect(out.certification.map((r) => r.name)).toEqual(['AFM', 'XPS'])
    expect(out.retired.map((r) => r.name)).toEqual(['Old sputterer'])
  })

  it('empty input yields three empty arrays (the page still renders its own EmptyState)', () => {
    expect(partitionCatalogue([] as Row[], toArgs)).toEqual({ available: [], certification: [], retired: [] })
  })
})
