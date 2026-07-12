// Pure helpers for the @-mention autocomplete used by IssueMentionInput. Extracted
// so the keyboard flow (query detection, active-option navigation, token insertion)
// is unit-testable without a DOM; the component stays a thin view over these.

// The token the renderer resolves is `<@userId>` — a cuid the user cannot type, so
// the picker MUST insert it; a literal `@name` is inert text, never a mention.
const TRAILING_AT = /@([\w-]*)$/

// The in-progress mention query = the `@word` immediately left of the caret, or
// null when the caret is not inside a mention. Empty string means "@" typed with
// no characters yet (matches everyone).
export function mentionQueryAt(value: string, caret: number): string | null {
  const m = TRAILING_AT.exec(value.slice(0, caret))
  return m ? m[1] : null
}

// Replace the trailing `@query` left of the caret with the resolved `<@id> ` token.
// Returns the new value and the caret position just after the inserted token.
export function insertMention(value: string, caret: number, userId: string): { value: string; caret: number } {
  const before = value.slice(0, caret).replace(TRAILING_AT, `<@${userId}> `)
  return { value: before + value.slice(caret), caret: before.length }
}

// Wrap-around active-option index for ArrowDown/ArrowUp over `count` matches. The
// current index is clamped into range first, so a shrunk match list never leaves
// the selection pointing past the end.
export function moveActive(current: number, key: 'ArrowUp' | 'ArrowDown', count: number): number {
  if (count <= 0) return 0
  const i = Math.min(Math.max(current, 0), count - 1)
  return key === 'ArrowDown' ? (i + 1) % count : (i + count - 1) % count
}
