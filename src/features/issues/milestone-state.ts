// Pure, client-safe (no server-only) — the strip and the server sort share it.

export type MilestoneLike = { id: string; name: string; date: string | null; completedAt: Date | string | null }
export type MilestoneDto = { id: string; name: string; date: string | null; completedAt: string | null }

export function toMilestoneDto(m: MilestoneLike): MilestoneDto {
  return { id: m.id, name: m.name, date: m.date, completedAt: m.completedAt ? new Date(m.completedAt).toISOString() : null }
}

// date-asc, undated last (then name asc) — the strip order.
export function sortMilestones<T extends MilestoneLike>(ms: T[]): T[] {
  return [...ms].sort((a, b) => {
    if (a.date && b.date) return a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? -1 : 1
    if (a.date) return -1
    if (b.date) return 1
    return a.name.localeCompare(b.name)
  })
}

export type MilestoneBucket = 'complete' | 'overdue' | 'upcoming'
// today = org-tz yyyy-MM-dd threaded from the server (the orgToday convention).
// Lexicographic yyyy-MM-dd compare is exact. Complete beats overdue.
export function milestoneBucket(m: MilestoneLike, today: string): MilestoneBucket {
  if (m.completedAt) return 'complete'
  if (m.date && m.date < today) return 'overdue'
  return 'upcoming'
}

// yyyy-MM-dd shape gate; the action layer additionally enforces calendar validity via z.string().date().
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
