'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, Plus } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { IconButton } from '@/components/ui/icon-button'
import { useChat } from './chat-store'

type ChannelRow = { id: string; name: string | null; topic: string; memberCount: number; isMember: boolean }

// Browse public channels + create a new one. The sidebar "+" opens this in browse mode;
// a "New channel" toggle flips the same modal to the create form (no nested dialogs).
export function BrowseAndCreate() {
  const router = useRouter()
  const { refresh } = useChat()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'browse' | 'create'>('browse')
  const [rows, setRows] = useState<ChannelRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // channel id being joined

  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!open || mode !== 'browse') return
    let cancelled = false
    fetch('/api/chat/channels')
      .then(async (r) => { if (!r.ok) throw new Error(); return (await r.json()).channels as ChannelRow[] })
      .then((c) => { if (!cancelled) { setRows(c); setError(null) } })
      .catch(() => { if (!cancelled) setError('Could not load channels.') })
    return () => { cancelled = true }
  }, [open, mode])

  function close() {
    setOpen(false); setMode('browse'); setRows(null); setError(null)
    setName(''); setTopic(''); setIsPrivate(false); setCreateErr(null)
  }

  async function join(id: string) {
    setBusy(id)
    try {
      const r = await fetch(`/api/chat/conversations/${id}/join`, { method: 'POST' })
      if (!r.ok) { setError('Could not join that channel.'); return }
      await refresh(); close(); router.push('/chat/' + id)
    } catch { setError('Could not join that channel.') } finally { setBusy(null) }
  }

  async function create() {
    const n = name.trim()
    if (!n || creating) return
    setCreating(true); setCreateErr(null)
    try {
      const r = await fetch('/api/chat/conversations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n, topic: topic.trim(), isPrivate }),
      })
      const d = await r.json().catch(() => null)
      if (r.status === 201 && d?.conversationId) { await refresh(); close(); router.push('/chat/' + d.conversationId) }
      else setCreateErr(d?.message ?? 'Could not create the channel.')
    } catch { setCreateErr('Could not create the channel.') } finally { setCreating(false) }
  }

  return (
    <>
      <IconButton label="Browse or create channels" onClick={() => setOpen(true)}><Plus size={18} /></IconButton>
      {open && (
        <Modal title={mode === 'browse' ? 'Channels' : 'New channel'} onClose={close}>
          {mode === 'browse' ? (
            <>
              <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
                {error && <p className="text-sm text-[var(--text-danger)]">{error}</p>}
                {!error && rows === null && <p className="text-sm text-subtle">Loading…</p>}
                {!error && rows?.length === 0 && <p className="text-sm text-subtle">No public channels yet.</p>}
                {rows?.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">#{c.name}</p>
                      {c.topic && <p className="truncate text-xs text-subtle">{c.topic}</p>}
                      <p className="text-[11px] text-subtle">{c.memberCount} {c.memberCount === 1 ? 'member' : 'members'}</p>
                    </div>
                    {c.isMember
                      ? <span className="shrink-0 text-xs font-medium text-subtle">Joined</span>
                      : <button onClick={() => join(c.id)} disabled={busy === c.id}
                          className="shrink-0 rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-on disabled:opacity-50">
                          {busy === c.id ? 'Joining…' : 'Join'}
                        </button>}
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end">
                <button onClick={() => { setMode('create'); setError(null) }} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on">New channel</button>
              </div>
            </>
          ) : (
            <>
              <label className="mt-4 block text-sm">Name
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus
                  placeholder="e.g. cvd-lab" className="mt-1 w-full rounded-md border border-border px-3 py-2" />
              </label>
              <label className="mt-3 block text-sm">Topic <span className="text-subtle">(optional)</span>
                <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={200}
                  placeholder="What's this channel about?" className="mt-1 w-full rounded-md border border-border px-3 py-2" />
              </label>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
                <span className="inline-flex items-center gap-1">Private (invitation only) <Lock size={13} aria-hidden /></span>
              </label>
              {createErr && <p className="mt-2 text-sm text-[var(--text-danger)]">{createErr}</p>}
              <div className="mt-4 flex justify-between">
                <button onClick={() => { setMode('browse'); setCreateErr(null) }} className="rounded-md border border-border px-3 py-1.5 text-sm">Back</button>
                <button onClick={create} disabled={creating || !name.trim()}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on disabled:opacity-50">
                  {creating ? 'Creating…' : 'Create channel'}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  )
}

// Start a direct message with 1–7 other people (self is added server-side → 2–8 total).
export function NewDmButton() {
  const router = useRouter()
  const { users, selfId, refresh } = useChat()
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const candidates = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return users.filter((u) => u.id !== selfId && (!q || u.name.toLowerCase().includes(q)))
  }, [users, selfId, filter])

  function close() { setOpen(false); setPicked(new Set()); setFilter(''); setError(null) }

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < 7) next.add(id) // 7 others + self = 8 max participants
      return next
    })
  }

  async function start() {
    if (picked.size === 0 || busy) return
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/chat/conversations/dm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: [...picked] }),
      })
      const d = await r.json().catch(() => null)
      if (r.ok && d?.conversationId) { await refresh(); close(); router.push('/chat/' + d.conversationId) }
      else setError(d?.message ?? 'Could not start the conversation.')
    } catch { setError('Could not start the conversation.') } finally { setBusy(false) }
  }

  return (
    <>
      <IconButton label="New direct message" onClick={() => setOpen(true)}><Plus size={18} /></IconButton>
      {open && (
        <Modal title="New message" onClose={close}>
          <p className="mt-1 text-xs text-subtle">Pick up to 7 people ({picked.size} selected).</p>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search people…"
            className="mt-3 w-full rounded-md border border-border px-3 py-2 text-sm" />
          <div className="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
            {candidates.length === 0 && <p className="p-2 text-sm text-subtle">No people found.</p>}
            {candidates.map((u) => {
              const on = picked.has(u.id)
              return (
                <button key={u.id} onClick={() => toggle(u.id)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-sm ${on ? 'bg-accent-subtle text-[var(--text-accent)]' : 'hover:bg-hover'}`}>
                  <span>{u.name}{u.role === 'guest' && <span className="ml-1 text-[11px] text-subtle">guest</span>}</span>
                  {on && <span aria-hidden>✓</span>}
                </button>
              )
            })}
          </div>
          {error && <p className="mt-2 text-sm text-[var(--text-danger)]">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={close} className="rounded-md border border-border px-3 py-1.5 text-sm">Cancel</button>
            <button onClick={start} disabled={busy || picked.size === 0}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on disabled:opacity-50">
              {busy ? 'Starting…' : 'Start'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
