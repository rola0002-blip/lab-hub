// Pure ordering for the sidebar conversation list. Channels group above DMs
// (mirrors the two sidebar sections); within a section unmuted items come first
// and muted ones sink to the end; channels then sort alphabetically by name and
// DMs by most-recent activity (newest first, never-messaged last). Extracted as a
// pure, dependency-free helper so it can be unit-tested in isolation.

export type SortableConversation = {
  id: string
  type: 'CHANNEL' | 'DM'
  name: string | null
  muted: boolean
  lastMessageAt: string | null
}

export function sortConversations<T extends SortableConversation>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    // Channels before DMs.
    if (a.type !== b.type) return a.type === 'CHANNEL' ? -1 : 1
    // Within a section: unmuted before muted.
    if (a.muted !== b.muted) return a.muted ? 1 : -1
    if (a.type === 'CHANNEL') return (a.name ?? '').localeCompare(b.name ?? '')
    // DMs: newest first; a null lastMessageAt (no messages yet) sorts last.
    const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : -Infinity
    const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : -Infinity
    return tb - ta
  })
}
