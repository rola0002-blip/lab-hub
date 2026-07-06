import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the db + redirect seams so requireSetup's control-flow is unit-testable.
const findFirst = vi.fn()
vi.mock('./db', () => ({ prisma: { organization: { findFirst: () => findFirst() } } }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`)
  },
}))

import { getOrg, requireSetup } from './org'

beforeEach(() => findFirst.mockReset())

describe('getOrg', () => {
  it('returns the first organization row', async () => {
    findFirst.mockResolvedValue({ id: 'o1', setupComplete: true })
    expect((await getOrg())?.id).toBe('o1')
  })
})

describe('requireSetup', () => {
  it('redirects to /setup when no org exists', async () => {
    findFirst.mockResolvedValue(null)
    await expect(requireSetup()).rejects.toThrow('REDIRECT:/setup')
  })
  it('redirects to /setup when setup is incomplete', async () => {
    findFirst.mockResolvedValue({ id: 'o1', setupComplete: false })
    await expect(requireSetup()).rejects.toThrow('REDIRECT:/setup')
  })
  it('returns the org once setup is complete', async () => {
    findFirst.mockResolvedValue({ id: 'o1', setupComplete: true })
    expect((await requireSetup()).id).toBe('o1')
  })
})
