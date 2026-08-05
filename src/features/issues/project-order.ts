// Pure helpers for the manually arranged /projects grid. Client components
// import this, so it must stay dependency-free — no `server-only`, no runtime
// imports at all.

// A neighbour pair for `moveProjectAction`: the project lands strictly between
// `prevId` and `nextId` (null = the front / the end of the list).
export type MoveTarget = { prevId: string | null; nextId: string | null }

export type MoveTargets = {
  front: MoveTarget | null
  earlier: MoveTarget | null
  later: MoveTarget | null
  end: MoveTarget | null
}

const NONE: MoveTargets = { front: null, earlier: null, later: null, end: null }

// Neighbour pairs for the four Move-menu commands, computed from the CURRENT
// visual order. A null command is a no-op at this position (already first /
// already last) and the menu item renders disabled.
//
// Positions are 0-based over the array WITHOUT the moved element, which is what
// the card actually slots into: moving to position `p` means
// `prevId = arr[p-1] ?? null`, `nextId = arr[p] ?? null`.
export function moveTargets(ids: readonly string[], index: number): MoveTargets {
  if (index < 0 || index >= ids.length) return { ...NONE }
  const isFirst = index === 0
  const isLast = index === ids.length - 1
  const rest = ids.filter((_, i) => i !== index)
  const at = (p: number): MoveTarget => ({ prevId: rest[p - 1] ?? null, nextId: rest[p] ?? null })

  return {
    front: isFirst ? null : at(0),
    earlier: isFirst ? null : at(index - 1),
    later: isLast ? null : at(index + 1),
    end: isLast ? null : at(rest.length),
  }
}

// Server-truth remount key for the grid (ProjectsClient keys its sortable list
// on this). The client seeds its local order from the server array ONCE and only
// its own drag/move handlers mutate it, so it re-syncs with server truth solely
// by remounting when this signature changes. It therefore must cover every field
// a project card renders, not just position: id + rank place the card, while
// updatedAt (bumped by @updatedAt on any project-row edit — name, status, lead,
// health) and the latest update's timestamp (which drives the "updated N days
// ago" chip) fingerprint its content, so a revalidation that changes CONTENT but
// not position still remounts past the seeded useState (board-signature.ts F1).
// Sorted by the encoded entry so a pure reorder of the server array (same
// projects, same fields) does not needlessly remount.
export function projectOrderSignature(
  items: readonly { id: string; rank: string; updatedAt: string; latestUpdate: { createdAt: string } | null }[],
): string {
  return items
    .map((p) => `${p.id}:${p.rank}:${p.updatedAt}:${p.latestUpdate?.createdAt ?? ''}`)
    .sort()
    .join('|')
}
