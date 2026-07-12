import { describe, it, expect } from 'vitest'
import { boardSignature } from '@/features/issues/board-signature'

type Row = { id: string; status: string; rank: string; updatedAt: string }
const mk = (over: Partial<Row> = {}): Row =>
  ({ id: 'i1', status: 'TODO', rank: 'V', updatedAt: '2026-07-12T00:00:00.000Z', ...over })

describe('boardSignature (F1 — board remount key)', () => {
  it('is stable for the same issues (no needless remount)', () => {
    const a = [mk({ id: 'a' }), mk({ id: 'b' })]
    const b = [mk({ id: 'a' }), mk({ id: 'b' })]
    expect(boardSignature(a)).toBe(boardSignature(b))
  })
  it('is order-independent — a pure array reorder of the same rows keeps the key', () => {
    const rows = [mk({ id: 'a' }), mk({ id: 'b' }), mk({ id: 'c' })]
    expect(boardSignature(rows)).toBe(boardSignature([...rows].reverse()))
  })
  it('CHANGES when a peer edits content (updatedAt bumps) — the fix for stale cards', () => {
    const before = [mk({ id: 'a', updatedAt: '2026-07-12T00:00:00.000Z' })]
    const after = [mk({ id: 'a', updatedAt: '2026-07-12T00:05:00.000Z' })] // title/priority/assignee edit
    expect(boardSignature(before)).not.toBe(boardSignature(after))
  })
  it('CHANGES on a status or rank change (position edits still remount)', () => {
    const base = [mk({ id: 'a' })]
    expect(boardSignature(base)).not.toBe(boardSignature([mk({ id: 'a', status: 'DONE' })]))
    expect(boardSignature(base)).not.toBe(boardSignature([mk({ id: 'a', rank: 'W' })]))
  })
})
