import { describe, it, expect } from 'vitest'
import { ISSUE_STATUSES, OPEN_STATUSES, STATUS_LABEL, STATUS_TOKEN, PRIORITIES, isDoneLike, LABEL_PALETTE, labelTextVar, parseIssueFilters } from '@/features/issues/status'

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
  it('labelTextVar maps every palette --status- token to a readable --label- text token (F6)', () => {
    // Chip TEXT must use the AA-compliant --label-* partner, not the 3:1 glyph hue.
    expect(labelTextVar('--status-in-progress')).toBe('--label-in-progress')
    for (const c of LABEL_PALETTE) expect(labelTextVar(c)).toBe(c.replace('--status-', '--label-'))
    // A non-status color is returned unchanged (defensive).
    expect(labelTextVar('--accent')).toBe('--accent')
  })
})

describe('parseIssueFilters (shareable-URL hardening)', () => {
  it('passes valid enum values and id params through', () => {
    expect(parseIssueFilters({ status: 'IN_PROGRESS', priority: 'URGENT', assignee: 'u1', project: 'p1', label: 'l1' }))
      .toEqual({ status: 'IN_PROGRESS', priority: 'URGENT', assignee: 'u1', project: 'p1', label: 'l1' })
    for (const s of ISSUE_STATUSES) expect(parseIssueFilters({ status: s }).status).toBe(s)
    for (const p of PRIORITIES) expect(parseIssueFilters({ priority: p }).priority).toBe(p)
  })
  it('coerces unknown, empty, and array-ish enum values to undefined (no Prisma enum 500)', () => {
    expect(parseIssueFilters({ status: 'foo', priority: 'bar' }))
      .toEqual({ status: undefined, priority: undefined, assignee: undefined, project: undefined, label: undefined })
    expect(parseIssueFilters({ status: '', priority: '' }).status).toBeUndefined()
    expect(parseIssueFilters({ status: '', priority: '' }).priority).toBeUndefined()
    expect(parseIssueFilters({ status: ['TODO', 'DONE'], priority: ['HIGH'] }).status).toBeUndefined()
    expect(parseIssueFilters({ status: ['TODO', 'DONE'], priority: ['HIGH'] }).priority).toBeUndefined()
    expect(parseIssueFilters({ status: 'todo' }).status).toBeUndefined() // case-sensitive: lowercase is not the enum
    expect(parseIssueFilters({})).toEqual({ status: undefined, priority: undefined, assignee: undefined, project: undefined, label: undefined })
  })
  it('leaves other params untouched, normalizing only empty/array values', () => {
    const f = parseIssueFilters({ status: 'DONE', assignee: 'user-1', project: '', label: ['l1', 'l2'], extra: 'ignored' })
    expect(f.status).toBe('DONE')
    expect(f.assignee).toBe('user-1')   // ids pass through unvalidated (service treats unknown ids as empty match)
    expect(f.project).toBeUndefined()   // empty string = no filter
    expect(f.label).toBeUndefined()     // array-ish = no filter
  })
  it('validates the due quick-filter to the fixed set (overdue | week)', () => {
    expect(parseIssueFilters({ due: 'overdue' }).due).toBe('overdue')
    expect(parseIssueFilters({ due: 'week' }).due).toBe('week')
    expect(parseIssueFilters({ due: 'nonsense' }).due).toBeUndefined() // stale/typo → no filter
    expect(parseIssueFilters({ due: '' }).due).toBeUndefined()
    expect(parseIssueFilters({ due: ['overdue'] }).due).toBeUndefined() // array-ish → no filter
    expect(parseIssueFilters({}).due).toBeUndefined()
  })
  it('parses stalled=true and degrades every other value (SP8 §5.4)', () => {
    expect(parseIssueFilters({ stalled: 'true' }).stalled).toBe(true)
    expect(parseIssueFilters({ stalled: '1' }).stalled).toBeUndefined()
    expect(parseIssueFilters({ stalled: ['true'] }).stalled).toBeUndefined()
    expect(parseIssueFilters({}).stalled).toBeUndefined()
  })
})
