'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SearchX } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { useChat } from './chat-store'
import { renderBody } from '@/features/chat/mentions'

// Membership-scoped full-text search. v1 jumps to the conversation (not the exact
// message) — deep-linking to a message id is deferred (see SDD plan-deviations ledger).
type Hit = {
  id: string; conversationId: string; conversationName: string | null; conversationType: 'CHANNEL' | 'DM'
  authorName: string; body: string; createdAt: string; rank: number
}

export default function SearchBox({ align = 'right' }: { align?: 'left' | 'right' }) {
  const router = useRouter()
  const { users } = useChat()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const names = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users])

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
    router.push('/chat/' + hit.conversationId)
  }

  return (
    <div ref={ref} className="relative">
      <input value={q}
        onChange={(e) => { const v = e.target.value; setQ(v); setOpen(true); if (!v.trim()) { setHits([]); setError(null) } }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }}
        placeholder="Search messages…" aria-label="Search messages"
        className="w-44 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:w-64" />
      {open && q.trim().length > 0 && (
        <div className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} z-30 mt-1 max-h-80 w-80 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg`}>
          {error && <p className="p-3 text-sm text-red-600">{error}</p>}
          {!error && hits.length === 0 && (
            <EmptyState icon={SearchX} title="No matches"
              hint={`Nothing matches “${q.trim()}”. Try a different word or check the spelling.`} />
          )}
          {hits.map((h) => (
            <button key={h.id} onClick={() => go(h)}
              className="block w-full border-b border-gray-100 px-3 py-2 text-left last:border-0 hover:bg-gray-50">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-medium text-gray-700">{h.conversationType === 'DM' ? h.authorName : '#' + (h.conversationName ?? '')}</span>
                <time className="shrink-0 text-gray-400">{new Date(h.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
              </div>
              <p className="mt-0.5 line-clamp-2 text-sm text-gray-800">
                <span className="text-gray-500">{h.authorName}: </span>{renderBody(h.body, names)}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
