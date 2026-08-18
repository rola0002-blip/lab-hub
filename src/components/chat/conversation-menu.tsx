'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Ellipsis } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { humanUsers } from '@/features/chat/roster'
import { useChat } from './chat-store'

type Props = {
  conversationId: string
  conversationType: 'CHANNEL' | 'DM'
  channelName: string | null
  archived: boolean
  manage: boolean
}

export default function ConversationMenu({ conversationId, conversationType, channelName, archived, manage }: Props) {
  const router = useRouter()
  const { conversations, selfId, refresh } = useChat()
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<'none' | 'members' | 'edit'>('none')
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const convo = conversations.find((c) => c.id === conversationId)
  const muted = !!convo?.muted
  const isChannel = conversationType === 'CHANNEL'

  useEffect(() => {
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  async function toggleMute() {
    setOpen(false); setBusy(true)
    try {
      await fetch(`/api/chat/conversations/${conversationId}/mute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ muted: !muted }),
      })
      await refresh()
    } catch { /* best-effort; the store keeps the prior mute state on failure */ } finally { setBusy(false) }
  }

  async function leave() {
    setBusy(true)
    try {
      const r = await fetch(`/api/chat/conversations/${conversationId}/members`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: selfId }),
      })
      if (r.ok) { await refresh(); router.push('/chat') }
    } catch { /* leaving failed; user stays a member */ } finally { setBusy(false) }
  }

  async function archive() {
    setBusy(true)
    try {
      const r = await fetch(`/api/chat/conversations/${conversationId}/archive`, { method: 'POST' })
      if (r.ok) { await refresh(); router.push('/chat') }
    } catch { /* archive failed; channel stays active */ } finally { setBusy(false); setConfirmArchive(false) }
  }

  const item = 'block w-full px-3 py-1.5 text-left text-sm hover:bg-hover disabled:opacity-50'

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)} aria-label="Conversation menu" disabled={busy}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors duration-100 hover:bg-hover hover:text-default disabled:opacity-50">
        <Ellipsis size={18} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-menu">
          <button onClick={() => { setOpen(false); window.open(window.location.href, '_blank', 'noopener') }} className={item}>Open in new window</button>
          <button onClick={toggleMute} className={item}>{muted ? 'Unmute' : 'Mute'}</button>
          {isChannel && manage && !archived && (
            <button onClick={() => { setOpen(false); setDialog('edit') }} className={item}>Edit channel…</button>
          )}
          {isChannel && <button onClick={() => { setOpen(false); setDialog('members') }} className={item}>Members…</button>}
          {isChannel && <button onClick={leave} className={item}>Leave channel</button>}
          {isChannel && manage && !archived && (
            <button onClick={() => { setOpen(false); setConfirmArchive(true) }} className={`${item} text-[var(--text-danger)]`}>Archive channel</button>
          )}
        </div>
      )}

      {dialog === 'edit' && (
        <EditChannelDialog conversationId={conversationId} initialName={convo?.name ?? channelName ?? ''}
          initialTopic={convo?.topic ?? ''} onClose={() => setDialog('none')} />
      )}

      {dialog === 'members' && (
        <MembersDialog conversationId={conversationId} channelName={channelName} manage={manage} onClose={() => setDialog('none')} />
      )}

      {confirmArchive && (
        <Modal title="Archive channel?" onClose={() => setConfirmArchive(false)}>
          <p className="mt-2 text-sm text-muted">Archiving #{channelName} hides it for everyone and stops new messages. This can’t be undone here.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setConfirmArchive(false)} className="rounded-md border border-border px-3 py-1.5 text-sm">Cancel</button>
            <button onClick={archive} disabled={busy} className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
              {busy ? 'Archiving…' : 'Archive'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// Members list with names; managers can add active users and remove existing ones.
// Exported so the channel-intro "Add people" action (message-pane) can reuse the
// exact same dialog rather than duplicate the add-members flow.
export function MembersDialog({ conversationId, channelName, manage, onClose }: { conversationId: string; channelName: string | null; manage: boolean; onClose: () => void }) {
  const { conversations, users, selfId, refresh } = useChat()
  const memberIds = conversations.find((c) => c.id === conversationId)?.memberIds ?? []
  const names = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // "Add people" is a human-facing chooser: exclude the bot (humanUsers) even though
  // it stays in `names` above for resolving existing members' labels. Without this,
  // the bot would surface as an addable candidate in every channel it isn't in.
  const memberSet = new Set(memberIds)
  const candidates = humanUsers(users).filter((u) => !memberSet.has(u.id))

  async function addMembers() {
    if (picked.size === 0 || busy) return
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/chat/conversations/${conversationId}/members`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userIds: [...picked] }),
      })
      if (!r.ok) { setError('Could not add members.'); return }
      setPicked(new Set()); await refresh()
    } catch { setError('Could not add members.') } finally { setBusy(false) }
  }

  async function remove(userId: string) {
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/chat/conversations/${conversationId}/members`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }),
      })
      if (!r.ok) { setError('Could not remove that member.'); return }
      await refresh()
    } catch { setError('Could not remove that member.') } finally { setBusy(false) }
  }

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  return (
    <Modal title={`Members of #${channelName ?? ''}`} onClose={onClose}>
      <div className="mt-3 max-h-56 space-y-0.5 overflow-y-auto">
        {memberIds.map((id) => (
          <div key={id} className="flex items-center justify-between rounded-md px-3 py-1.5 text-sm hover:bg-hover">
            <span>{names.get(id) ?? 'unknown'}{id === selfId && <span className="ml-1 text-[11px] text-subtle">you</span>}</span>
            {manage && id !== selfId && (
              <button onClick={() => remove(id)} disabled={busy} className="text-xs text-[var(--text-danger)] hover:underline disabled:opacity-50">Remove</button>
            )}
          </div>
        ))}
      </div>

      {manage && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-subtle">Add people</p>
          <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
            {candidates.length === 0 && <p className="px-1 text-sm text-subtle">Everyone is already a member.</p>}
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
          <div className="mt-2 flex justify-end">
            <button onClick={addMembers} disabled={busy || picked.size === 0}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on disabled:opacity-50">
              {busy ? 'Adding…' : `Add${picked.size ? ` ${picked.size}` : ''}`}
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-[var(--text-danger)]">{error}</p>}
    </Modal>
  )
}

// Rename a channel and/or edit its topic (managers only). Mirrors the create
// form; on success refreshes the store (sidebar) and the server component
// (header name/topic) via router.refresh().
function EditChannelDialog({ conversationId, initialName, initialTopic, onClose }:
  { conversationId: string; initialName: string; initialTopic: string; onClose: () => void }) {
  const router = useRouter()
  const { refresh } = useChat()
  const [name, setName] = useState(initialName)
  const [topic, setTopic] = useState(initialTopic)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    const n = name.trim()
    if (!n || busy) return
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/chat/conversations/${conversationId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n, topic: topic.trim() }),
      })
      if (!r.ok) { const d = await r.json().catch(() => null); setError(d?.error ?? 'Could not update the channel.'); return }
      await refresh(); router.refresh(); onClose()
    } catch { setError('Could not update the channel.') } finally { setBusy(false) }
  }

  return (
    <Modal title="Edit channel" onClose={onClose}>
      <label className="mt-4 block text-sm">Name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus
          className="mt-1 w-full rounded-md border border-border px-3 py-2" />
      </label>
      <label className="mt-3 block text-sm">Topic <span className="text-subtle">(optional)</span>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={200}
          placeholder="What's this channel about?" className="mt-1 w-full rounded-md border border-border px-3 py-2" />
      </label>
      {error && <p className="mt-2 text-sm text-[var(--text-danger)]">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm">Cancel</button>
        <button onClick={save} disabled={busy || !name.trim()}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on disabled:opacity-50">
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  )
}
