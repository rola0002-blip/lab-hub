// The rendered issue identifier is COL-<number>. The COL- prefix is a single code
// constant (workspace brand), never per-project.
export const ISSUE_PREFIX = 'COL'

export function formatIdentifier(n: number): string {
  return `${ISSUE_PREFIX}-${n}`
}

// Parse COL-<n> (case-insensitive) → positive integer, else null.
export function parseIdentifier(s: string): number | null {
  const m = /^col-(\d+)$/i.exec(s.trim())
  if (!m) return null
  const n = Number(m[1])
  return Number.isSafeInteger(n) && n > 0 ? n : null
}
