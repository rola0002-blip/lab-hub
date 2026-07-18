import { describe, it, expect } from 'vitest'
import { filterCommands, type Cmd } from '@/lib/palette'

const cmds = [
  { id: '1', label: 'Dashboard', href: '/dashboard', kind: 'page' as const },
  { id: '2', label: 'general', href: '/chat/g', kind: 'channel' as const },
  { id: '3', label: 'Wei Lin', href: '/chat/w', kind: 'dm' as const },
]
describe('filterCommands', () => {
  it('subsequence-matches case-insensitively and ranks prefix first', () => {
    expect(filterCommands(cmds, 'dash')[0].id).toBe('1')
    expect(filterCommands(cmds, 'wl').map((c) => c.id)).toContain('3')  // subsequence W..L..
    expect(filterCommands(cmds, '').length).toBe(3)
  })

  // Additional coverage for the pure scorer (keeps src/lib/palette.ts above the gate).
  it('returns the original order untouched for an empty / whitespace query', () => {
    expect(filterCommands(cmds, '   ').map((c) => c.id)).toEqual(['1', '2', '3'])
  })

  it('ranks exact > prefix > word-boundary > subsequence', () => {
    const items: Cmd[] = [
      { id: 'sub', label: 'Backup', href: '/a', kind: 'page' }, // subsequence a..p only
      { id: 'word', label: 'My apps', href: '/b', kind: 'page' }, // word-boundary 'apps'
      { id: 'prefix', label: 'Approvals', href: '/c', kind: 'page' }, // whole-string prefix
      { id: 'exact', label: 'ap', href: '/d', kind: 'page' }, // exact
    ]
    expect(filterCommands(items, 'ap').map((c) => c.id)).toEqual(['exact', 'prefix', 'word', 'sub'])
  })

  it('is case-insensitive on both sides and excludes non-matches', () => {
    const out = filterCommands(cmds, 'GEN')
    expect(out.map((c) => c.id)).toEqual(['2'])
  })

  it('breaks ties by original index (stable)', () => {
    const items: Cmd[] = [
      { id: 'a', label: 'Booking', href: '/1', kind: 'page' },
      { id: 'b', label: 'Bookings', href: '/2', kind: 'page' },
    ]
    // both prefix-match 'book' with equal tier -> original order preserved
    expect(filterCommands(items, 'book').map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('drops everything when nothing matches', () => {
    expect(filterCommands(cmds, 'zzzz')).toEqual([])
  })

  // The ⌘K palette merges issue-search rows (kind 'issue') and a static
  // 'Create issue' command (kind 'command') into the same list; filterCommands
  // must rank them by label alongside pages/channels/people.
  it('ranks and filters the merged issue + command kinds by label', () => {
    const items: Cmd[] = [
      { id: 'create-issue', label: 'Create issue', sub: 'Command', href: '', kind: 'command' },
      { id: 'i1', label: 'LAB-7 Fix memristor drift', sub: 'Issue', href: '/issues/LAB-7', kind: 'issue' },
      { id: 'p1', label: 'Dashboard', href: '/dashboard', kind: 'page' },
    ]
    // 'memristor' is a word-boundary hit only on the issue row.
    expect(filterCommands(items, 'memristor').map((c) => c.id)).toEqual(['i1'])
    // 'create' prefix-matches the command row and nothing else here.
    expect(filterCommands(items, 'create').map((c) => c.id)).toEqual(['create-issue'])
  })
})
