import { emojiFor } from './emoji'

// A flat, ordered token stream for a message body. Rendered to React nodes by
// message-item.tsx — never to HTML strings (no dangerouslySetInnerHTML). This
// SUBSUMES the old renderTokens mention/URL handling and adds markdown + emoji.
// Keep `Token` / `tokenizeMessage` names stable: the emoji picker (Task 12) and
// search excerpts (Tasks 15/17) depend on them.
export type TokenType =
  | 'text' | 'bold' | 'italic' | 'strike'
  | 'code' | 'codeblock' | 'quote' | 'listitem'
  | 'mention' | 'channel' | 'link' | 'emoji' | 'issueRef'

// `label` is the visible text of a markdown `[text](url)` link (the href lives
// in `value`); it is undefined for a bare-URL link (which renders its url).
// Additive-only: existing consumers read `type`/`value`/`userId` unchanged.
export type Token = { type: TokenType; value: string; userId?: string; label?: string }

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
// Word-bounded COL-<digits>. `(?<![\w-])` / `(?![\w-])` keep COLA-1 / COL-1a /
// a-COL-1 from matching. Runs only on non-code text (inline/fenced code is peeled
// off first), so `COL-9` inside a code span is inherently skipped.
const ISSUE_REF = /(?<![\w-])COL-(\d+)(?![\w-])/g
// Markdown links `[text](url)`: label is any run without `]`, url any run
// without `)`/whitespace. Backtracking-safe (one `*`/`+` per negated class).
// Scheme validation happens in the tokenizer, not the regex (see HTTP below).
const MDLINK = /\[([^\]]*)\]\(([^)\s]+)\)/g
// Only http/https destinations may become an href — mirrors the bare-URL
// scheme-lock so a `javascript:`/`data:`/relative url can never be linkified.
const HTTP = /^https?:\/\//
// Bare URLs. The trailing char class excludes sentence punctuation so
// `(see https://x.com)` links to `https://x.com`, not `…com)`. The final atom
// is a single char (a subset of the preceding run), so the engine backtracks at
// most once per trailing punct — linear, no nested unbounded quantifier.
const LINK = /https?:\/\/[^\s]*[^\s.,;:!?)]/g
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
// then markdown `[text](url)` links (BEFORE bare-URL autolinking, so a link's
// `(url)` is not re-scanned), then bare links, emphasis, emoji shortnames, and
// finally raw unicode emoji.
const rawEmoji: Sub = (s) => split(s, RAW_EMOJI, (m) => ({ type: 'emoji', value: m[0] }), plain)
const shortcodes: Sub = (s) => split(s, SHORTCODE, (m) => {
  const g = emojiFor(m[1])
  return g ? { type: 'emoji', value: g } : null
}, rawEmoji)
const strike: Sub = (s) => split(s, STRIKE, (m) => ({ type: 'strike', value: m[1] }), shortcodes)
const italic: Sub = (s) => split(s, ITALIC, (m) => ({ type: 'italic', value: m[1] }), strike)
const bold: Sub = (s) => split(s, BOLD, (m) => ({ type: 'bold', value: m[1] }), italic)
const links: Sub = (s) => split(s, LINK, (m) => ({ type: 'link', value: m[0] }), bold)
// Markdown `[text](url)` runs BEFORE the bare-URL pass so a link's `(url)` is
// never re-scanned. Scheme-locked: a non-http(s) url (javascript:/data:/
// relative/empty) returns null, leaving the whole marker as literal text
// (re-parsed by `links`), so it can never become an href. An empty label falls
// back to the url as its visible text (`label` undefined → renderer shows url).
const mdLinks: Sub = (s) => split(s, MDLINK, (m) =>
  HTTP.test(m[2]) ? { type: 'link', value: m[2], label: m[1] || undefined } : null,
  links)
// Issue autolink `COL-<n>` runs after mentions (so a mention is never re-scanned)
// and before markdown links. Value is the bare number; the renderer resolves it to
// a live pill (identifier + title + status) or falls back to `COL-<n>` plain text.
const issueRefs: Sub = (s) => split(s, ISSUE_REF, (m) => ({ type: 'issueRef', value: m[1] }), mdLinks)
const mentions: Sub = (s) => split(s, MENTION, (m) =>
  m[0] === '<!channel>' ? { type: 'channel', value: 'channel' } : { type: 'mention', value: m[1], userId: m[1] },
  issueRefs)
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

// Flatten a message body to a single human-readable line for screen-reader
// announcement (the #live-msgs region). Reuses the same token stream the visible
// message renders from, then drops the syntax noise a sighted reader never sees:
// markdown markers (`**`, `` ` ``, fences), a link's URL in favour of its label,
// and the `<@id>` mention/`<!channel>` syntax in favour of a readable @name.
// `resolveMention` maps a userId to a display name (falls back to a generic
// "mention" when the user isn't known yet). Collapses whitespace/newlines so a
// multi-line body announces as one utterance.
export function messageToPlainText(body: string, resolveMention?: (userId: string) => string | undefined): string {
  return tokenizeMessage(body)
    .map((t) => {
      switch (t.type) {
        case 'mention': return `@${resolveMention?.(t.value) ?? 'mention'}`
        case 'channel': return '@channel'
        case 'link': return t.label ?? t.value // spoken text is the visible label, never the raw href
        case 'issueRef': return `COL-${t.value}` // announce the identifier, not the bare number
        default: return t.value // text/bold/italic/strike/code/codeblock/quote/listitem/emoji
      }
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}
