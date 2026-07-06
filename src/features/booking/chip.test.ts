import { describe, it, expect } from 'vitest'
import { statusChip } from './chip'

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
