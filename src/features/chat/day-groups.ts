// W20-A: chat day grouping — pure + CLIENT-SAFE (the unread.ts posture). The pane
// renders each local day's run inside ONE wrapper so the sticky day pill's
// containing block is its own day: the next day's wrapper pushes the previous pill
// off the top instead of every passed pill pinning at the same offset and stacking
// (the flat-sibling bug). The key is the viewer-local calendar day — the SAME
// toDateString predicate MessageItem's `newDay` uses — and NEVER the first row's
// id: "Load earlier" prepends same-day rows INTO the existing group, and a key
// change would remount every row in it (dropping MessageItem edit drafts).
// The list is ascending in practice, but the pane's upsert appends in ARRIVAL
// order, so near local midnight a late send confirmation can land after the next
// day's first row. A day that reappears gets an occurrence-suffixed key
// (`<day>#1`, …) so React keys stay unique; the first run keeps the bare day key,
// which is the one Load earlier grows.
export type DayGroup<T> = { key: string; day: string; start: number; items: T[] }

export function dayKey(iso: string): string {
  return new Date(iso).toDateString()
}

export function groupByDay<T extends { createdAt: string }>(items: T[]): DayGroup<T>[] {
  const groups: DayGroup<T>[] = []
  const runs = new Map<string, number>()
  items.forEach((it, i) => {
    const day = dayKey(it.createdAt)
    const last = groups[groups.length - 1]
    if (last && last.day === day) { last.items.push(it); return }
    const n = runs.get(day) ?? 0
    runs.set(day, n + 1)
    groups.push({ key: n === 0 ? day : `${day}#${n}`, day, start: i, items: [it] })
  })
  return groups
}
