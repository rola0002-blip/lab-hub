// Pure ordering for the sidebar conversation list. Channels group above DMs
// (mirrors the two sidebar sections); within a section favorites partition to
// the top (W4-A2 — no cross-section promotion: a favorited DM never jumps into
// the channel section), then unmuted items come before muted ones; channels
// then sort alphabetically by name and DMs by most-recent activity (newest
// first, never-messaged last). Extracted as a pure, dependency-free helper so
// it can be unit-tested in isolation.

export type SortableConversation = {
  id: string
  type: 'CHANNEL' | 'DM'
  name: string | null
  muted: boolean
  favorite?: boolean
  lastMessageAt: string | null
}

export function sortConversations<T extends SortableConversation>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    // Channels before DMs.
    if (a.type !== b.type) return a.type === 'CHANNEL' ? -1 : 1
    // Within a section: favorites first (the partition preserves the relative
    // order below inside EACH partition — favoriting only ever outranks, it
    // never reorders peers).
    if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1
    // Then: unmuted before muted.
    if (a.muted !== b.muted) return a.muted ? 1 : -1
    if (a.type === 'CHANNEL') return (a.name ?? '').localeCompare(b.name ?? '')
    // DMs: newest first; a null lastMessageAt (no messages yet) sorts last.
    const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : -Infinity
    const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : -Infinity
    return tb - ta
  })
}
