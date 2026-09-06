import { describe, it, expect, vi } from 'vitest'

// export-service pulls the prisma singleton at import; the unit suite runs with
// no DB env — stub the module (we test the PURE helper only; the DB paths are
// covered by tests/integration/equipment-export.test.ts).
vi.mock('@/lib/db', () => ({ prisma: {} }))

import { exportFilename } from '@/features/equipment/export-service'

describe('exportFilename', () => {
  it('slugs the equipment name into an ASCII-safe xlsx filename', () => {
    expect(exportFilename('Atomic force microscope')).toBe('labhub-atomic-force-microscope-records.xlsx')
    expect(exportFilename('PECVD #2 (blue)')).toBe('labhub-pecvd-2-blue-records.xlsx')
    expect(exportFilename('---leading--and-trailing---')).toBe('labhub-leading-and-trailing-records.xlsx')
  })

  it('falls back when nothing slugifiable remains', () => {
    expect(exportFilename('')).toBe('labhub-equipment-records.xlsx')
    expect(exportFilename('显微镜')).toBe('labhub-equipment-records.xlsx')
    expect(exportFilename('---')).toBe('labhub-equipment-records.xlsx')
  })
})
