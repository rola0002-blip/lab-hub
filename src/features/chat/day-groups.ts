// W20-A: chat day grouping — pure + CLIENT-SAFE (the unread.ts posture). The pane
// renders each local day's run inside ONE wrapper so the sticky day pill's
// containing block is its own day: the next day's wrapper pushes the previous pill
// off the top instead of every passed pill pinning at the same offset and stacking
// (the flat-sibling bug). The key is the viewer-local calendar day — the SAME
// toDateString predicate MessageItem's `newDay` uses — and NEVER the first row's
// id: "Load earlier" prepends same-day rows INTO the existing group, and a key
// change would remount every row in it (dropping MessageItem edit drafts).
// Input must be ascending by createdAt (the pane's order), so a day key never
// reappears in a later group.
export type DayGroup<T> = { key: string; start: number; items: T[] }

export function dayKey(iso: string): string {
  return new Date(iso).toDateString()
}

export function groupByDay<T extends { createdAt: string }>(items: T[]): DayGroup<T>[] {
  const groups: DayGroup<T>[] = []
  items.forEach((it, i) => {
    const key = dayKey(it.createdAt)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(it)
    else groups.push({ key, start: i, items: [it] })
  })
  return groups
}
