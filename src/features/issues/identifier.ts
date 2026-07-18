// The rendered issue identifier is LAB-<number>. The LAB- prefix is a single code
// constant (workspace brand), never per-project. Everything newly rendered, parsed
// back, announced, or searched uses this prefix.
export const ISSUE_PREFIX = 'LAB'

// COL- is the pre-rebrand prefix. It is recognized READ-ONLY as an alias so the
// archived bot posts (~59 literal `COL-n` messages on the deployed instance) and any
// stale links still RESOLVE to the same issue number — but nothing is ever rendered
// or announced with it (formatIdentifier only ever emits ISSUE_PREFIX). Kept purely
// for backward-compatible parsing/scanning; see CLAUDE.md "Brand vs identifiers".
export const LEGACY_ISSUE_PREFIX = 'COL'

// Alternation of the canonical + legacy prefixes, for parse/scan only. Consumers
// (this module + the chat tokenizer in markdown.ts) compose their own RegExp from
// ISSUE_REF_PATTERN so the accepted prefixes never drift across the two places.
const PREFIX_GROUP = `(?:${ISSUE_PREFIX}|${LEGACY_ISSUE_PREFIX})`

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

// Parse LAB-<n> (or the legacy COL-<n> alias), case-insensitive → positive int4
// issue number, else null.
const IDENTIFIER_RE = new RegExp(`^${PREFIX_GROUP}-(\\d+)$`, 'i')
export function parseIdentifier(s: string): number | null {
  const m = IDENTIFIER_RE.exec(s.trim())
  if (!m) return null
  const n = Number(m[1])
  return inRange(n) ? n : null
}

// Word-bounded scan pattern for LAB-<n> (and the legacy COL-<n> alias). Case-
// sensitive (uppercase). `(?<![\w-])` / `(?![\w-])` keep LABS-1 / LAB-1a / a-LAB-1
// from matching. Exported so the chat tokenizer (markdown.ts) builds the identical
// matcher from one source instead of a hand-synced duplicate.
export const ISSUE_REF_PATTERN = `(?<![\\w-])${PREFIX_GROUP}-(\\d+)(?![\\w-])`

// Scan free text for word-bounded issue references. Distinct, positive, in order.
// The server detail page and the chat pane both use it to collect the numbers to
// resolve. Over-collecting a ref that sits inside a code span is harmless — it just
// resolves one extra number.
const REF_SCAN = new RegExp(ISSUE_REF_PATTERN, 'g')
export function extractIssueRefNumbers(s: string): number[] {
  return [...new Set([...s.matchAll(REF_SCAN)].map((m) => Number(m[1])))]
    .filter(inRange)
}
