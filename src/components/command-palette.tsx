'use client'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Hash, Lock, LayoutGrid, MessageSquare, ListTodo, Plus, FileText } from 'lucide-react'
import { NAV_SECTIONS, isNavVisible } from '@/components/sidebar'
import { Avatar } from '@/components/ui/avatar'
import { useChat, dmName } from '@/components/chat/chat-store'
import { useGlobalHotkey } from '@/components/hooks/use-global-hotkey'
import { openIssueComposer } from '@/lib/issue-composer-store'
import { useFocusTrap } from '@/components/hooks/use-focus-trap'
import { nextRovingIndex } from '@/lib/roving'
import { filterCommands, type Cmd } from '@/lib/palette'
import type { Role } from '@/lib/session'

const RECENTS_KEY = 'colossus:palette:recents'
const RECENTS_MAX = 6

// Composite identity so a page href never collides with a conversation/user id.
const cmdKey = (c: Cmd) => `${c.kind}:${c.id}`

function readRecents(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function pushRecent(key: string): string[] {
  const next = [key, ...readRecents().filter((k) => k !== key)].slice(0, RECENTS_MAX)
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
    } catch {
      /* storage disabled/full — recents are best-effort */
    }
  }
  return next
}

// Stable reorder: commands whose key is in `recents` float to the top in
// most-recent-first order; everything else keeps its original order.
function recentsFirst(items: Cmd[], recents: string[]): Cmd[] {
  if (recents.length === 0) return items
  const rank = new Map(recents.map((k, i) => [k, i]))
  const seen = items.filter((c) => rank.has(cmdKey(c))).sort((a, b) => rank.get(cmdKey(a))! - rank.get(cmdKey(b))!)
  const rest = items.filter((c) => !rank.has(cmdKey(c)))
  return [...seen, ...rest]
}

function KindIcon({ cmd }: { cmd: Cmd }) {
  if (cmd.kind === 'page') return <LayoutGrid size={16} aria-hidden className="shrink-0 text-subtle" />
  if (cmd.kind === 'channel') return (cmd.sub === 'Private channel'
    ? <Lock size={16} aria-hidden className="shrink-0 text-subtle" />
    : <Hash size={16} aria-hidden className="shrink-0 text-subtle" />)
  if (cmd.kind === 'person') return <MessageSquare size={16} aria-hidden className="shrink-0 text-subtle" />
  if (cmd.kind === 'issue') return <ListTodo size={16} aria-hidden className="shrink-0 text-subtle" />
  if (cmd.kind === 'command') return <Plus size={16} aria-hidden className="shrink-0 text-subtle" />
  if (cmd.kind === 'document') return <FileText size={16} aria-hidden className="shrink-0 text-subtle" />
  return null // dm rows render an Avatar instead
}

export function CommandPalette({ orgName = 'LabHub', role }: { orgName?: string; role: Role }) {
  const router = useRouter()
  const { conversations, users, selfId } = useChat()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [recents, setRecents] = useState<string[]>([])
  const [issueHits, setIssueHits] = useState<Cmd[]>([])
  const [docHits, setDocHits] = useState<Cmd[]>([])
  const dialogRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const optionId = (i: number) => `${listId}-opt-${i}`

  useFocusTrap(dialogRef, open)

  // Full destination list — navigation only (pages + channels + DMs + people),
  // never message content. Page rows are role-gated identically to the Sidebar.
  const items = useMemo<Cmd[]>(() => {
    const pages: Cmd[] = NAV_SECTIONS.flatMap((sec) =>
      sec.items
        .filter((i) => isNavVisible(i.href, role))
        .map((i) => ({ id: i.href, label: i.label, sub: sec.title, href: i.href, kind: 'page' as const })),
    )
    const channels: Cmd[] = conversations
      .filter((c) => c.type === 'CHANNEL' && !c.archived)
      .map((c) => ({
        id: c.id, label: c.name ?? '', sub: c.isPrivate ? 'Private channel' : 'Channel',
        href: `/chat/${c.id}`, kind: 'channel' as const,
      }))
    const dms: Cmd[] = conversations
      .filter((c) => c.type === 'DM')
      .map((c) => ({ id: c.id, label: dmName(c, users, selfId), sub: 'Direct message', href: `/chat/${c.id}`, kind: 'dm' as const }))
    // People without an existing 1:1 DM — selecting starts (or reopens) one.
    const peered = new Set(
      conversations
        .filter((c) => c.type === 'DM' && c.memberIds.length === 2)
        .map((c) => c.memberIds.find((id) => id !== selfId)),
    )
    const people: Cmd[] = users
      .filter((u) => u.id !== selfId && !peered.has(u.id))
      .map((u) => ({ id: u.id, label: u.name, sub: 'Message', href: `/chat?dm=${u.id}`, kind: 'person' as const }))
    // Non-guests get a static "Create issue" command that raises the composer.
    const commands: Cmd[] = role !== 'guest'
      ? [{ id: 'create-issue', label: 'Create issue', sub: 'Command', href: '', kind: 'command' as const }]
      : []
    return [...commands, ...pages, ...channels, ...dms, ...people, ...issueHits, ...docHits]
  }, [conversations, users, selfId, role, issueHits, docHits])

  const ordered = useMemo(() => (query.trim() ? items : recentsFirst(items, recents)), [items, recents, query])
  const results = useMemo(() => filterCommands(ordered, query), [ordered, query])

  const openPalette = useCallback(() => {
    setRecents(readRecents())
    setQuery('')
    setActive(0)
    setIssueHits([]) // drop any stale hits so a fresh empty-query open shows only destinations
    setDocHits([])
    setOpen(true)
  }, [])
  const close = useCallback(() => setOpen(false), [])

  // Debounced issue search: an exact LAB-n identifier jumps straight to the
  // issue (closing the palette); anything else merges into the results as
  // `kind: 'issue'` rows. State is set only after the awaited round-trip, so
  // react-hooks/set-state-in-effect is satisfied (same pattern as SearchBox).
  useEffect(() => {
    const q = query.trim()
    if (!q) { return }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/issues/search?q=${encodeURIComponent(q)}`)
        if (!r.ok) return
        const d = await r.json()
        if (d.jump) { setOpen(false); router.push(d.jump); return } // exact LAB-n jumps straight in
        setIssueHits((d.hits as { id: string; identifier: string; title: string }[]).map((h) => ({ id: h.id, label: `${h.identifier} ${h.title}`, sub: 'Issue', href: `/issues/${h.identifier}`, kind: 'issue' as const })))
      } catch { /* transient */ }
    }, 250)
    return () => clearTimeout(t)
  }, [query, router])

  // Debounced document search: merges kind:'document' rows (label = filename); a
  // selection opens the file in a new tab (see select()). Mirrors the issue-search
  // effect above, minus the exact-identifier jump (documents have no LAB-n).
  useEffect(() => {
    const q = query.trim()
    if (!q) { return }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/documents/search?q=${encodeURIComponent(q)}`)
        if (!r.ok) return
        const d = await r.json()
        setDocHits((d.hits as { id: string; name: string; path: string }[]).map((h) => ({ id: h.id, label: h.name, sub: 'File', href: h.path, kind: 'document' as const })))
      } catch { /* transient */ }
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  useGlobalHotkey('k', openPalette, { meta: true })

  const dmMember = (c: Cmd) => conversations.find((x) => x.id === c.id)
  const dmPeer = (c: Cmd) => {
    const conv = dmMember(c)
    return conv?.memberIds.find((id) => id !== selfId)
  }

  async function select(cmd: Cmd) {
    setRecents(pushRecent(cmdKey(cmd)))
    close()
    if (cmd.kind === 'document') { window.open(cmd.href, '_blank', 'noopener'); return }
    if (cmd.kind === 'command' && cmd.id === 'create-issue') { openIssueComposer(); return }
    if (cmd.kind === 'person') {
      // No static DM yet: create-or-open the 1:1, then navigate to it.
      try {
        const r = await fetch('/api/chat/conversations/dm', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userIds: [cmd.id] }),
        })
        const d = await r.json().catch(() => null)
        if (r.ok && d?.conversationId) { router.push(`/chat/${d.conversationId}`); return }
      } catch {
        /* fall through to the chat home on failure */
      }
      router.push('/chat')
      return
    }
    router.push(cmd.href)
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      const cmd = results[active]
      if (cmd) void select(cmd)
      return
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault()
      const idx = nextRovingIndex(active, results.length, e.key)
      setActive(idx < 0 ? 0 : idx)
      // Keep the active option in view without a layout effect.
      document.getElementById(optionId(idx))?.scrollIntoView({ block: 'nearest' })
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openPalette}
        aria-haspopup="dialog"
        className="flex h-8 min-w-0 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-sm text-muted hover:bg-hover md:w-72"
      >
        <Search size={15} aria-hidden className="shrink-0" />
        <span className="truncate">Search {orgName}</span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-border px-1 text-2xs font-medium text-subtle md:inline">⌘K</kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 p-4 pt-[12vh]"
          onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="w-full max-w-lg overflow-hidden rounded-xl bg-surface shadow-modal"
          >
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search size={16} aria-hidden className="shrink-0 text-subtle" />
              <input
                autoFocus
                type="text"
                role="combobox"
                aria-expanded={true}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-label={`Search ${orgName}`}
                aria-activedescendant={results[active] ? optionId(active) : undefined}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); if (!e.target.value.trim()) { setIssueHits([]); setDocHits([]) } }}
                onKeyDown={onInputKeyDown}
                placeholder="Jump to a page, channel, or person…"
                className="h-12 w-full bg-transparent text-sm text-default outline-none placeholder:text-subtle"
              />
            </div>
            <ul id={listId} role="listbox" aria-label="Results" className="max-h-80 overflow-y-auto p-1.5">
              {results.length === 0 ? (
                <li role="option" aria-selected={false} aria-disabled className="px-3 py-6 text-center text-sm text-subtle">
                  No matches
                </li>
              ) : (
                results.map((cmd, i) => {
                  const selected = i === active
                  const peerId = cmd.kind === 'dm' ? dmPeer(cmd) : undefined
                  return (
                    <li
                      key={cmdKey(cmd)}
                      id={optionId(i)}
                      role="option"
                      aria-selected={selected}
                      onMouseDown={(e) => { e.preventDefault(); void select(cmd) }}
                      onMouseEnter={() => setActive(i)}
                      className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm ${
                        selected ? 'bg-selected text-[var(--text-accent)]' : 'text-default'
                      }`}
                    >
                      {cmd.kind === 'dm'
                        ? <Avatar size={20} name={cmd.label} id={peerId ?? cmd.id} image={null} />
                        : <KindIcon cmd={cmd} />}
                      <span className="min-w-0 flex-1 truncate">{cmd.label}</span>
                      {cmd.sub && <span className="shrink-0 text-2xs uppercase tracking-wide text-muted">{cmd.sub}</span>}
                    </li>
                  )
                })
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}
