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

// Scan free text for word-bounded COL-<n> references. Distinct, positive, in order.
// Deliberately mirrors the chat tokenizer's word-bounded pattern (markdown.ts): the
// server detail page and the chat pane both use it to collect the numbers to
// resolve. Over-collecting a ref that sits inside a code span is harmless — it just
// resolves one extra number.
const REF_SCAN = /(?<![\w-])COL-(\d+)(?![\w-])/g
export function extractIssueRefNumbers(s: string): number[] {
  return [...new Set([...s.matchAll(REF_SCAN)].map((m) => Number(m[1])))]
    .filter((n) => Number.isSafeInteger(n) && n > 0)
}
