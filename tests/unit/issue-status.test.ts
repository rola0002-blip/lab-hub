import { describe, it, expect } from 'vitest'
import { ISSUE_STATUSES, OPEN_STATUSES, STATUS_LABEL, STATUS_TOKEN, PRIORITIES, isDoneLike, LABEL_PALETTE } from '@/features/issues/status'

describe('issue status metadata', () => {
  it('covers all six statuses with labels + tokens in board order', () => {
    expect(ISSUE_STATUSES).toEqual(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELED'])
    for (const s of ISSUE_STATUSES) { expect(STATUS_LABEL[s]).toBeTruthy(); expect(STATUS_TOKEN[s]).toMatch(/^--status-/) }
  })
  it('open statuses exclude the closed ones', () => {
    expect(OPEN_STATUSES).toEqual(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW'])
    expect(isDoneLike('DONE')).toBe(true); expect(isDoneLike('CANCELED')).toBe(true); expect(isDoneLike('TODO')).toBe(false)
    expect(PRIORITIES).toEqual(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  })
  it('label palette cycles over the fixed status-token set', () => {
    expect(LABEL_PALETTE.length).toBeGreaterThan(0)
    for (const c of LABEL_PALETTE) expect(c).toMatch(/^--status-/)
  })
})
