'use client'
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { SearchX } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import { humanTime } from '@/lib/humanize'
import { tokenizeMessage } from '@/features/chat/markdown'
import { ISSUE_PREFIX } from '@/features/issues/identifier'
import { useChat } from './chat-store'

// Membership-scoped full-text search. A click deep-links to the exact message
// (`/chat/<cid>?msg=<id>`); message-pane consumes `?msg=` to scroll+flash it.
type Hit = {
  id: string; conversationId: string; conversationName: string | null; conversationType: 'CHANNEL' | 'DM'
  authorId: string; authorName: string; authorImage: string | null
  body: string; createdAt: string; rank: number
}

type Names = Map<string, string>

// Case-insensitive literal highlight of every query term inside a text run. No
// regex (query terms are user input) and no dangerouslySetInnerHTML — matches
// are wrapped in real <mark> nodes.
function highlight(text: string, terms: string[]): ReactNode[] {
  if (terms.length === 0) return [text]
  const lower = text.toLowerCase()
  const out: ReactNode[] = []
  let i = 0
  let key = 0
  while (i < text.length) {
    // Earliest match of any term at or after i.
    let at = -1
    let len = 0
    for (const t of terms) {
      const idx = lower.indexOf(t, i)
      if (idx !== -1 && (at === -1 || idx < at)) { at = idx; len = t.length }
    }
    if (at === -1) { out.push(text.slice(i)); break }
    if (at > i) out.push(text.slice(i, at))
    out.push(<mark key={key++} className="rounded-xs bg-mention px-0.5 text-default">{text.slice(at, at + len)}</mark>)
    i = at + len
  }
  return out
}

// Compact, safe excerpt: tokenize the body (mentions/links/emphasis/emoji) and
// render inline nodes, highlighting query terms inside plain text. Block tokens
// (code fences, quotes, list items) collapse to inline text for the preview.
export function renderExcerpt(body: string, names: Names, terms: string[]): ReactNode[] {
  return tokenizeMessage(body).map((t, k) => {
    switch (t.type) {
      case 'bold': return <strong key={k} className="font-semibold">{highlight(t.value, terms)}</strong>
      case 'italic': return <em key={k}>{highlight(t.value, terms)}</em>
      case 'strike': return <s key={k}>{highlight(t.value, terms)}</s>
      case 'code':
      case 'codeblock': return <code key={k} className="rounded bg-surface-sunken px-1 font-mono text-[12px]">{t.value}</code>
      case 'mention': return <span key={k} className="font-medium text-[var(--text-accent)]">@{names.get(t.userId ?? t.value) ?? 'unknown'}</span>
      case 'channel': return <span key={k} className="font-medium text-[var(--text-accent)]">@channel</span>
      case 'link': return <span key={k} className="text-link">{t.label ?? t.value}</span>
      case 'emoji': return <span key={k}>{t.value}</span>
      // issueRef `value` is the BARE number (the prefix was consumed by the match,
      // whether it was LAB- or the legacy COL- alias), so re-add the canonical LAB-
      // prefix — a compact plain-text identifier, highlight-aware, so a search for
      // "LAB-5" still marks the term (the pill treatment is reserved for full message
      // bodies; excerpts stay compact).
      case 'issueRef': return <Fragment key={k}>{highlight(`${ISSUE_PREFIX}-${t.value}`, terms)}</Fragment>
      // text / quote / listitem
      default: return <Fragment key={k}>{highlight(t.value, terms)}</Fragment>
    }
  })
}

export default function SearchBox({ align = 'left', orgName }: { align?: 'left' | 'right'; orgName?: string }) {
  const router = useRouter()
  const { users } = useChat()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const names = useMemo<Names>(() => new Map(users.map((u) => [u.id, u.name])), [users])
  const terms = useMemo(() =>
    [...new Set(q.trim().toLowerCase().split(/\s+/).filter((w) => w.length >= 2))],
    [q])
  const now = new Date() // viewer-local reference for humanized result times

  useEffect(() => {
    const query = q.trim()
    if (!query) return // cleared results live in the onChange handler, not here (avoids sync setState-in-effect)
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/chat/search?q=${encodeURIComponent(query)}`)
        if (!r.ok) { setError('Search failed.'); setHits([]); return }
        setHits((await r.json()).hits); setError(null)
      } catch { setError('Search failed.'); setHits([]) }
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  function go(hit: Hit) {
    setOpen(false); setQ(''); setHits([])
    // Deep-link to the exact message (Task 13 copy-link URL shape); message-pane
    // scrolls to it and flashes the mention tint.
    router.push(`/chat/${hit.conversationId}?msg=${hit.id}`)
  }

  return (
    <div ref={ref} className="relative">
      <input value={q}
        onChange={(e) => { const v = e.target.value; setQ(v); setOpen(true); if (!v.trim()) { setHits([]); setError(null) } }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }}
        placeholder={orgName ? `Search ${orgName}` : 'Search messages…'} aria-label="Search messages"
        className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-default transition-colors placeholder:text-subtle hover:border-border-strong focus-visible:border-[var(--border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
      {open && q.trim().length > 0 && (
        <div className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} z-30 mt-1 max-h-96 w-80 overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-menu`}>
          {error && <p className="p-3 text-sm text-[var(--text-danger)]">{error}</p>}
          {!error && hits.length === 0 && (
            <EmptyState icon={SearchX} title="No matches"
              hint={`Nothing matches “${q.trim()}”. Try a different word or check the spelling.`} />
          )}
          {hits.map((h) => (
            <button key={h.id} type="button" onClick={() => go(h)}
              className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring-focus)]">
              <Avatar size={36} name={h.authorName} id={h.authorId} image={h.authorImage} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold text-default">{h.authorName}</span>
                    <span className="text-subtle"> · {h.conversationType === 'DM' ? 'DM' : '#' + (h.conversationName ?? '')}</span>
                  </span>
                  <time className="shrink-0 text-subtle">{humanTime(h.createdAt, now)}</time>
                </span>
                <span className="mt-0.5 block line-clamp-2 text-sm text-muted">
                  {renderExcerpt(h.body, names, terms)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
