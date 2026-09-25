// Pure, client-safe comparators for the /files listing header sort (wave 18).
// `createdAtIso` is a raw ISO string — the row's display `created` is org-tz
// FORMATTED text and mis-sorts lexicographically ('1 Sep 2026' vs '25 Sep 2025').
export type SortKey = 'name' | 'folder' | 'size' | 'uploader' | 'created'
export type SortState = { key: SortKey; dir: 'asc' | 'desc' } | null

export type SortableRow = {
  name: string; folderName: string | null; size: number; uploaderName: string; createdAtIso: string
}

// Tri-state per column: default → asc → desc → back to service order; a different
// column always starts at asc.
export function nextSortState(current: SortState, key: SortKey): SortState {
  if (!current || current.key !== key) return { key, dir: 'asc' }
  if (current.dir === 'asc') return { key, dir: 'desc' }
  return null
}

export function sortDocuments<T extends SortableRow>(rows: T[], state: SortState): T[] {
  if (!state) return rows
  const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })
  const cmp: Record<SortKey, (a: T, b: T) => number> = {
    name: (a, b) => text(a.name, b.name),
    folder: (a, b) => text(a.folderName ?? '', b.folderName ?? ''), // root (null) clusters FIRST in asc
    size: (a, b) => a.size - b.size,
    uploader: (a, b) => text(a.uploaderName, b.uploaderName),
    created: (a, b) => (a.createdAtIso < b.createdAtIso ? -1 : a.createdAtIso > b.createdAtIso ? 1 : 0),
  }
  const c = cmp[state.key]
  return [...rows].sort((a, b) => (state.dir === 'asc' ? c(a, b) : -c(a, b)))
}
