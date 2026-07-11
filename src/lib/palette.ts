// Pure, framework-free command model + fuzzy filter for the ⌘K palette.
// Kept out of the React component so it is unit-testable and covered by the gate.

export type Cmd = {
  id: string
  label: string
  sub?: string
  href: string
  kind: 'page' | 'channel' | 'dm' | 'person'
}

// True when every char of `needle` appears in `hay` in order (case pre-lowered).
function isSubsequence(hay: string, needle: string): boolean {
  let i = 0
  for (const ch of hay) {
    if (i < needle.length && ch === needle[i]) i += 1
  }
  return i === needle.length
}

// Match quality, higher = better: exact(4) > prefix(3) > word-boundary(2) >
// subsequence(1) > no match(0). Case-insensitive on both sides.
function score(label: string, q: string): number {
  const h = label.toLowerCase()
  if (h === q) return 4
  if (h.startsWith(q)) return 3
  if (h.split(/[^a-z0-9]+/i).some((w) => w.length > 0 && w.startsWith(q))) return 2
  if (isSubsequence(h, q)) return 1
  return 0
}

// Filter + rank commands by a query. Empty/whitespace query returns the input
// untouched (so callers can front-load recents); otherwise ranks prefix >
// word-boundary > subsequence, breaking ties by original index (stable).
export function filterCommands(items: Cmd[], query: string): Cmd[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items
    .map((item, index) => ({ item, index, s: score(item.label, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.index - b.index)
    .map((x) => x.item)
}
