import type { IssueDto } from './issue-service'

// Remount key for the board (IssuesSurface keys <BoardView> on this). BoardView
// seeds its local state from `initial` ONCE and only its drag handlers mutate it,
// so it re-syncs with server truth solely by remounting when this signature
// changes. It therefore must cover EVERY field a board card renders, not just
// position: id + status + rank place the card, and updatedAt (bumped by @updatedAt
// on every issue-row update — title/priority/assignee) fingerprints its content, so
// a peer's SSE-driven non-position edit remounts the board instead of leaving the
// seeded useState showing stale text (F1). Sorted by id so a pure reorder of the
// server array (same issues) does not needlessly remount.
export function boardSignature(issues: Pick<IssueDto, 'id' | 'status' | 'rank' | 'updatedAt'>[]): string {
  return [...issues]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((i) => `${i.id}:${i.status}:${i.rank}:${i.updatedAt}`)
    .join('|')
}
