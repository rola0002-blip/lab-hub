import { describe, it, expect } from 'vitest'
import { sortConversations } from '@/features/chat/sort'

// Fixture builder. The brief's block typed `o` as `Partial<any>`; the repo lint
// bans `any`, so it's typed explicitly here — the assertions below are unchanged.
type SortInput = { id: string; type?: 'CHANNEL' | 'DM'; name?: string; muted?: boolean; lastMessageAt?: string | null }
const C = (o: SortInput) => ({ id: o.id, type: o.type ?? 'CHANNEL', name: o.name ?? '', muted: !!o.muted, lastMessageAt: o.lastMessageAt ?? null, ...o })
describe('sortConversations', () => {
  it('channels alphabetical, muted last', () => {
    const out = sortConversations([C({ id: '1', name: 'zebra' }), C({ id: '2', name: 'alpha' }), C({ id: '3', name: 'beta', muted: true })])
    expect(out.map((c) => c.id)).toEqual(['2', '1', '3'])
  })
  it('DMs by recency, muted last', () => {
    const out = sortConversations([
      C({ id: 'a', type: 'DM', lastMessageAt: '2026-07-01' }),
      C({ id: 'b', type: 'DM', lastMessageAt: '2026-07-05' }),
      C({ id: 'c', type: 'DM', lastMessageAt: '2026-07-09', muted: true }),
    ])
    expect(out.map((c) => c.id)).toEqual(['b', 'a', 'c'])
  })
  it('groups channels above DMs and sinks never-messaged DMs last', () => {
    const out = sortConversations([
      C({ id: 'd1', type: 'DM', lastMessageAt: null }),
      C({ id: 'ch', type: 'CHANNEL', name: 'general' }),
      C({ id: 'd2', type: 'DM', lastMessageAt: '2026-07-05' }),
    ])
    expect(out.map((c) => c.id)).toEqual(['ch', 'd2', 'd1'])
  })
})
