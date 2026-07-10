'use client'
import { useMemo, useRef, useState } from 'react'
import { useChat } from './chat-store'
import type { Msg } from './message-item'

type Props = {
  conversationId: string
  selfRole: string
  memberIds: string[]
  parentId?: string
  onSent: (m: Msg) => void
  onRemove: (tempId: string) => void
}

type Attach = { path: string; name: string; mime: string; size: number }
type Item = { label: string; token: string }

// Scan back from the caret for an `@` that starts a mention query. The `@` must sit
// at a word boundary (start-of-line or after whitespace); the query is the run of
// id-safe chars between it and the caret.
function detectMention(value: string, caret: number): { start: number; query: string } | null {
  let i = caret - 1
  while (i >= 0 && /[a-zA-Z0-9_-]/.test(value[i])) i--
  if (i < 0 || value[i] !== '@') return null
  const before = i === 0 ? '' : value[i - 1]
  if (before && !/\s/.test(before)) return null
  return { start: i, query: value.slice(i + 1, caret) }
}

// v1 tradeoff (settled in the task brief): the textarea holds RAW token text
// (`<@id>`, `<!channel>`) directly — autocomplete inserts tokens, and a hint line
// explains they render as friendly @Name once sent. No rich-text dual buffer.
export default function Composer({ conversationId, selfRole, memberIds, parentId, onSent, onRemove }: Props) {
  const { users, selfId } = useChat()
  const [raw, setRaw] = useState('')
  const [attachments, setAttachments] = useState<Attach[]>([])
  const [menu, setMenu] = useState<{ start: number; items: Item[] } | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(0)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const lastTyping = useRef(0)

  const self = users.find((u) => u.id === selfId)
  const selfName = self?.name ?? 'You'
  const selfImage = self?.image ?? null
  const memberUsers = useMemo(() => {
    const ids = new Set(memberIds)
    return users.filter((u) => ids.has(u.id))
  }, [memberIds, users])

  function updateMenu(value: string, caret: number) {
    const det = detectMention(value, caret)
    if (!det) { setMenu(null); return }
    const q = det.query.toLowerCase()
    const items: Item[] = []
    if (selfRole !== 'guest' && 'channel'.startsWith(q)) items.push({ label: '@channel', token: '<!channel>' })
    for (const u of memberUsers) {
      if (items.length >= 8) break
      if (u.name.toLowerCase().includes(q)) items.push({ label: u.name, token: `<@${u.id}>` })
    }
    if (!items.length) { setMenu(null); return }
    setMenu({ start: det.start, items }); setActiveIdx(0)
  }

  function insert(item: Item) {
    if (!menu) return
    const el = taRef.current
    const caret = el ? el.selectionStart : raw.length
    const inserted = raw.slice(0, menu.start) + item.token + ' '
    setRaw(inserted + raw.slice(caret))
    setMenu(null)
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(inserted.length, inserted.length) } })
  }

  function maybeTyping() {
    if (parentId) return // thread drafts don't surface as channel typing
    const now = Date.now()
    if (now - lastTyping.current < 3000) return
    lastTyping.current = now
    void fetch(`/api/chat/conversations/${conversationId}/typing`, { method: 'POST' })
  }

  async function onFiles(files: FileList) {
    setError(null)
    for (const file of Array.from(files)) {
      setUploading((n) => n + 1)
      try {
        const fd = new FormData(); fd.append('file', file)
        const r = await fetch('/api/chat/attachments', { method: 'POST', body: fd })
        const d = await r.json().catch(() => null)
        if (r.ok && d) setAttachments((prev) => [...prev, { path: d.path, name: d.name, mime: d.mime, size: d.size }])
        else setError(d?.message ?? 'Upload failed.')
      } catch { setError('Upload failed.') } finally { setUploading((n) => n - 1) }
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  async function send() {
    const body = raw.trim()
    if ((!body && attachments.length === 0) || busy || uploading > 0) return
    setError(null)
    // send() only runs from the Send button / Enter key — never during render — so these
    // clock reads are safe; the compiler's purity check can't see the event-handler boundary.
    // eslint-disable-next-line react-hooks/purity
    const tempId = 'tmp-' + Date.now()
    const temp: Msg = {
      id: tempId, conversationId, parentId: parentId ?? null,
      author: { id: selfId, name: selfName, image: selfImage },
      body, deleted: false, editedAt: null, createdAt: new Date().toISOString(),
      replyCount: 0, reactions: [],
      attachments: attachments.map((a, i) => ({ id: `${tempId}-a${i}`, ...a })),
      mentionUserIds: [], mentionsChannel: false,
    }
    const payload = { conversationId, body, ...(parentId ? { parentId } : {}), ...(attachments.length ? { attachments } : {}) }
    onSent(temp)
    setMenu(null); setBusy(true)
    try {
      const r = await fetch('/api/chat/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const d = await r.json().catch(() => null)
      if (r.status === 201 && d?.message) {
        onSent(d.message)
        // Clear the draft only once the send is confirmed (201); on failure we keep it for retry.
        setRaw(''); setAttachments([])
      } else {
        // Send failed: drop the optimistic temp entirely (no tombstone) and keep the draft.
        setError(d?.message ?? 'Failed to send.'); onRemove(tempId)
      }
    } catch {
      setError('Failed to send.'); onRemove(tempId)
    } finally { setBusy(false) }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (menu) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => (i + 1) % menu.items.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => (i - 1 + menu.items.length) % menu.items.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(menu.items[activeIdx]); return }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
  }

  return (
    <div className="relative border-t border-gray-200 p-3">
      {menu && (
        <ul className="absolute bottom-full left-3 z-20 mb-1 w-64 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
          {menu.items.map((it, i) => (
            <li key={it.token}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); insert(it) }}
                className={`block w-full px-3 py-1.5 text-left text-sm ${i === activeIdx ? 'bg-accent/10 text-accent' : 'hover:bg-gray-100'}`}>
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((a, i) => (
            <span key={a.path} className="flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700">
              <span className="max-w-[10rem] truncate">📎 {a.name}</span>
              <button onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-gray-700" aria-label="Remove attachment">✕</button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => e.target.files && onFiles(e.target.files)} />
        <button type="button" onClick={() => fileRef.current?.click()} title="Attach a file"
          className="rounded-md border border-gray-300 px-2 py-2 text-sm text-gray-500 hover:bg-gray-50">📎</button>
        <textarea ref={taRef} value={raw} rows={1} placeholder={parentId ? 'Reply in thread…' : 'Write a message…'}
          onChange={(e) => { setRaw(e.target.value); updateMenu(e.target.value, e.target.selectionStart); maybeTyping() }}
          onKeyDown={onKeyDown} onBlur={() => setTimeout(() => setMenu(null), 100)}
          className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-md border border-gray-300 px-3 py-2 text-sm" />
        <button type="button" onClick={send} disabled={busy || uploading > 0 || (!raw.trim() && attachments.length === 0)}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? 'Sending…' : uploading > 0 ? 'Uploading…' : 'Send'}
        </button>
      </div>

      <p className="mt-1 text-[11px] text-gray-400">
        Enter to send · Shift+Enter for a newline · mentions insert as tokens (they render as @Name once sent).
      </p>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
