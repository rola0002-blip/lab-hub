import { describe, it, expect } from 'vitest'
import { humanUsers } from './roster'

describe('humanUsers', () => {
  const roster = [
    { id: 'u1', name: 'Roland', isSystem: false },
    { id: 'colossus-bot', name: 'COLOSSUS Bot', isSystem: true },
    { id: 'u2', name: 'Ada', isSystem: false },
  ]
  it('drops system users (the bot) from a chooser list', () => {
    expect(humanUsers(roster).map((u) => u.id)).toEqual(['u1', 'u2'])
  })
  it('is a no-op when there are no system users', () => {
    const humans = roster.filter((u) => !u.isSystem)
    expect(humanUsers(humans)).toEqual(humans)
  })
  it('returns empty for an empty roster', () => {
    expect(humanUsers([])).toEqual([])
  })
})
