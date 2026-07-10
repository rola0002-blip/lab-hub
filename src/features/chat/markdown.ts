import { emojiFor } from './emoji'

// A flat, ordered token stream for a message body. Rendered to React nodes by
// message-item.tsx — never to HTML strings (no dangerouslySetInnerHTML). This
// SUBSUMES the old renderTokens mention/URL handling and adds markdown + emoji.
// Keep `Token` / `tokenizeMessage` names stable: the emoji picker (Task 12) and
// search excerpts (Tasks 15/17) depend on them.
export type TokenType =
  | 'text' | 'bold' | 'italic' | 'strike'
  | 'code' | 'codeblock' | 'quote' | 'listitem'
  | 'mention' | 'channel' | 'link' | 'emoji'

export type Token = { type: TokenType; value: string; userId?: string }

// ── Regexes ──────────────────────────────────────────────────────────────────
// All patterns are backtracking-safe: negated character classes with a single
// `+`/`*`, fixed literals, and zero-width lookarounds — no nested unbounded
// quantifiers. The one lazy quantifier (fence body) is bounded by a literal
// closing delimiter, so it is linear-ish, never exponential.

// Fenced code: everything between the outer ``` delimiters. Extracted FIRST so
// backticks, `<@…>` and `:name:` inside code are never mis-parsed.
const FENCE = /```([\s\S]*?)```/g
// Inline code: single backticks, no newline, no embedded backtick.
const INLINE_CODE = /`([^`\n]+)`/g
// Mentions (id-safe alphabet, matching mentions.ts) and the channel token.
const MENTION = /<@([a-zA-Z0-9_-]+)>|<!channel>/g
// Bare URLs (identical to the previous renderTokens behavior).
const LINK = /https?:\/\/[^\s]+/g
const BOLD = /\*\*([^*\n]+)\*\*/g
// Italic underscores must sit on non-word boundaries so `snake_case` is left alone.
const ITALIC = /(?<![\w])_([^_\n]+)_(?![\w])/g
const STRIKE = /~([^~\n]+)~/g
// Emoji shortnames like :tada: / :+1:.
const SHORTCODE = /:([a-z0-9_+-]+):/g
// Raw unicode emoji: a pictographic base plus optional variation selector
// (U+FE0F), skin-tone modifier, or ZWJ-joined (U+200D) pictographs. Each
// alternative in the repeat starts with a distinct code point, so it is linear.
const RAW_EMOJI = /\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic})*/gu

// Split `s` on `re`, emitting a token per match (via `make`) and recursing into
// the surrounding gaps with `next`. A null from `make` means "not really a token"
// (e.g. an unknown emoji shortname): the matched text is re-parsed by `next` so it
// survives as literal text rather than vanishing.
type Sub = (s: string) => Token[]
function split(s: string, re: RegExp, make: (m: RegExpExecArray) => Token | null, next: Sub): Token[] {
  if (s === '') return []
  const out: Token[] = []
  let last = 0
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push(...next(s.slice(last, m.index)))
    const tok = make(m)
    if (tok) out.push(tok)
    else out.push(...next(m[0]))
    last = m.index + m[0].length
    if (m[0].length === 0) re.lastIndex++ // defensive: never spin on a zero-width match
  }
  if (last < s.length) out.push(...next(s.slice(last)))
  return out
}

// Leaf: anything unmatched by every pass is literal text.
const plain: Sub = (s) => (s === '' ? [] : [{ type: 'text', value: s }])

// Inline pipeline (order matters): inline code protects its contents first, then
// mentions/channel (higher priority than emphasis so `**<@u>**` keeps the mention),
// then links, emphasis, emoji shortnames, and finally raw unicode emoji.
const rawEmoji: Sub = (s) => split(s, RAW_EMOJI, (m) => ({ type: 'emoji', value: m[0] }), plain)
const shortcodes: Sub = (s) => split(s, SHORTCODE, (m) => {
  const g = emojiFor(m[1])
  return g ? { type: 'emoji', value: g } : null
}, rawEmoji)
const strike: Sub = (s) => split(s, STRIKE, (m) => ({ type: 'strike', value: m[1] }), shortcodes)
const italic: Sub = (s) => split(s, ITALIC, (m) => ({ type: 'italic', value: m[1] }), strike)
const bold: Sub = (s) => split(s, BOLD, (m) => ({ type: 'bold', value: m[1] }), italic)
const links: Sub = (s) => split(s, LINK, (m) => ({ type: 'link', value: m[0] }), bold)
const mentions: Sub = (s) => split(s, MENTION, (m) =>
  m[0] === '<!channel>' ? { type: 'channel', value: 'channel' } : { type: 'mention', value: m[1], userId: m[1] },
  links)
const inline: Sub = (s) => split(s, INLINE_CODE, (m) => ({ type: 'code', value: m[1] }), mentions)

// Line-level pass over a non-fenced segment: `> ` → quote, `- `/`* ` → list item,
// otherwise inline tokens. Original newlines are re-emitted as text tokens so
// multi-line plain messages render exactly as before (whitespace-pre-wrap).
const QUOTE_LINE = /^> ?(.*)$/
const LIST_LINE = /^[-*] (.+)$/
function tokenizeText(segment: string): Token[] {
  if (segment === '') return []
  const out: Token[] = []
  const lines = segment.split('\n')
  lines.forEach((line, i) => {
    const q = QUOTE_LINE.exec(line)
    const li = LIST_LINE.exec(line)
    if (q) out.push({ type: 'quote', value: q[1] })
    else if (li) out.push({ type: 'listitem', value: li[1] })
    else out.push(...inline(line))
    if (i < lines.length - 1) out.push({ type: 'text', value: '\n' })
  })
  return out
}

// Strip a leading ```lang info line and one trailing newline from a fence body.
function cleanFence(body: string): string {
  let code = body
  const nl = code.indexOf('\n')
  if (nl !== -1 && /^[A-Za-z0-9_+#.-]*$/.test(code.slice(0, nl))) code = code.slice(nl + 1)
  return code.replace(/\n$/, '')
}

// Entry point: pull fenced code blocks out first (they must not be re-parsed),
// then tokenize the text between them line-by-line.
export function tokenizeMessage(body: string): Token[] {
  const out: Token[] = []
  let last = 0
  FENCE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = FENCE.exec(body)) !== null) {
    if (m.index > last) out.push(...tokenizeText(body.slice(last, m.index)))
    out.push({ type: 'codeblock', value: cleanFence(m[1]) })
    last = m.index + m[0].length
  }
  if (last < body.length) out.push(...tokenizeText(body.slice(last)))
  return out
}
