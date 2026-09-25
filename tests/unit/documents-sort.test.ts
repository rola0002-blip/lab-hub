import { describe, it, expect } from 'vitest'
import { nextSortState, sortDocuments, type SortState, type SortableRow } from '@/features/documents/sort'

const R = (o: Partial<SortableRow> & { name: string }): SortableRow => ({
  folderName: null, size: 0, uploaderName: '', createdAtIso: '2026-01-01T00:00:00.000Z', ...o,
})

describe('nextSortState', () => {
  it('cycles null → asc → desc → null on the same key', () => {
    let s: SortState = null
    s = nextSortState(s, 'folder'); expect(s).toEqual({ key: 'folder', dir: 'asc' })
    s = nextSortState(s, 'folder'); expect(s).toEqual({ key: 'folder', dir: 'desc' })
    s = nextSortState(s, 'folder'); expect(s).toBeNull()
  })
  it('switching columns restarts at asc', () => {
    expect(nextSortState({ key: 'folder', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' })
  })
})

describe('sortDocuments', () => {
  it('returns the SAME array reference for null state', () => {
    const rows = [R({ name: 'b' }), R({ name: 'a' })]
    expect(sortDocuments(rows, null)).toBe(rows)
  })
  it('clusters root first, then folders A→Z, and flips on desc', () => {
    const rows = [R({ name: 'z-in-chem', folderName: 'chemical list' }), R({ name: 'root-2', folderName: null }), R({ name: 'a-in-alpha', folderName: 'alpha' })]
    expect(sortDocuments(rows, { key: 'folder', dir: 'asc' }).map((r) => r.name)).toEqual(['root-2', 'a-in-alpha', 'z-in-chem'])
    expect(sortDocuments(rows, { key: 'folder', dir: 'desc' }).map((r) => r.name)).toEqual(['z-in-chem', 'a-in-alpha', 'root-2'])
  })
  it('sorts names case-insensitively and sizes numerically', () => {
    const names = [R({ name: 'Beta' }), R({ name: 'alpha' })]
    expect(sortDocuments(names, { key: 'name', dir: 'asc' }).map((r) => r.name)).toEqual(['alpha', 'Beta'])
    const sizes = [R({ name: 'big', size: 900 }), R({ name: 'small', size: 80 })]
    expect(sortDocuments(sizes, { key: 'size', dir: 'desc' })[0].name).toBe('big')
  })
  it('orders created by ISO string — the formatted display string would mis-sort', () => {
    const rows = [R({ name: 'newer', createdAtIso: '2026-09-25T00:00:00.000Z' }), R({ name: 'older', createdAtIso: '2025-09-25T00:00:00.000Z' })]
    expect(sortDocuments(rows, { key: 'created', dir: 'asc' })[0].name).toBe('older')
  })
  it('sorts by uploader case-insensitively', () => {
    const rows = [R({ name: 'r-zed', uploaderName: 'Zed' }), R({ name: 'r-ana', uploaderName: 'ana' }), R({ name: 'r-bo', uploaderName: 'Bo' })]
    expect(sortDocuments(rows, { key: 'uploader', dir: 'asc' }).map((r) => r.name)).toEqual(['r-ana', 'r-bo', 'r-zed'])
    expect(sortDocuments(rows, { key: 'uploader', dir: 'desc' }).map((r) => r.name)).toEqual(['r-zed', 'r-bo', 'r-ana'])
  })
})
