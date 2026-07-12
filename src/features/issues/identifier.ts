// The rendered issue identifier is COL-<number>. The COL- prefix is a single code
// constant (workspace brand), never per-project.
export const ISSUE_PREFIX = 'COL'

// Issue.number is a Postgres int4 (nextval on issue_number_seq). A parsed number
// above this max is not a real issue and, if fed to a Prisma Int predicate, makes
// Postgres raise `22003 value out of range` → unhandled 500. Bounding here (the
// single parse choke point) turns those into a clean notFound()/empty-hits.
export const ISSUE_NUMBER_MAX = 2147483647

function inRange(n: number): boolean {
  return Number.isSafeInteger(n) && n > 0 && n <= ISSUE_NUMBER_MAX
}

export function formatIdentifier(n: number): string {
  return `${ISSUE_PREFIX}-${n}`
}

// Parse COL-<n> (case-insensitive) → positive int4 issue number, else null.
export function parseIdentifier(s: string): number | null {
  const m = /^col-(\d+)$/i.exec(s.trim())
  if (!m) return null
  const n = Number(m[1])
  return inRange(n) ? n : null
}

// Scan free text for word-bounded COL-<n> references. Distinct, positive, in order.
// Deliberately mirrors the chat tokenizer's word-bounded pattern (markdown.ts): the
// server detail page and the chat pane both use it to collect the numbers to
// resolve. Over-collecting a ref that sits inside a code span is harmless — it just
// resolves one extra number.
const REF_SCAN = /(?<![\w-])COL-(\d+)(?![\w-])/g
export function extractIssueRefNumbers(s: string): number[] {
  return [...new Set([...s.matchAll(REF_SCAN)].map((m) => Number(m[1])))]
    .filter(inRange)
}
