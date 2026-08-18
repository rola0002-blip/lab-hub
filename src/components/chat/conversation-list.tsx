'use client'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Hash, Lock, BellOff, MoreHorizontal } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Menu } from '@/components/ui/menu'
import { sortConversations } from '@/features/chat/sort'
import { useChat, dmName } from './chat-store'
import { BrowseAndCreate, NewDmButton } from './channel-dialogs'

export default function ConversationList({ role }: { role: string }) {
  const { conversations, users, online, selfId, refresh } = useChat()
  const router = useRouter()
  const params = useParams<{ conversationId?: string }>()
  const active = params?.conversationId
  const channels = sortConversations(conversations.filter((c) => c.type === 'CHANNEL' && !c.archived))
  const dms = sortConversations(conversations.filter((c) => c.type === 'DM'))

  // Row-level actions mirror the header ⋯ menu's best-effort posture: a failed
  // call is swallowed (the store keeps the prior state) — no toast in the rail.
  async function toggleMute(c: (typeof conversations)[number]) {
    try {
      await fetch(`/api/chat/conversations/${c.id}/mute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ muted: !c.muted }),
      })
      await refresh()
    } catch { /* best-effort; the store keeps the prior mute state on failure */ }
  }

  async function leave(c: (typeof conversations)[number]) {
    try {
      const r = await fetch(`/api/chat/conversations/${c.id}/members`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: selfId }),
      })
      if (!r.ok) return
      await refresh()
      // Leaving the conversation you're reading lands you back on the chat index;
      // leaving any other row keeps the open pane untouched.
      if (c.id === active) router.push('/chat')
    } catch { /* leaving failed; user stays a member */ }
  }

  const row = (c: (typeof conversations)[number]) => {
    const isDm = c.type === 'DM'
    const selected = c.id === active
    const label = isDm ? dmName(c, users, selfId) : c.name ?? ''
    // Presence reuses the store's `online` set (the same source the old bare dot used):
    // the DM peer is the first member that isn't me.
    const peerId = isDm ? c.memberIds.find((id) => id !== selfId) : undefined
    const peerOnline = peerId ? online.has(peerId) : false
    const peerImage = peerId ? c.members.find((m) => m.id === peerId)?.image ?? null : null
    // A muted row never bolds and never shows an unread count; the mention badge
    // still fires so an @you can't be silenced. Selected wins the styling for the
    // conversation you're actively reading.
    const cls = selected
      ? 'bg-selected text-[var(--text-accent)] font-semibold'
      : c.muted
        ? 'text-subtle hover:bg-hover'
        : c.unread > 0
          ? 'font-semibold text-default hover:bg-hover'
          : 'text-muted hover:bg-hover'
    // The row-level ⋯ menu (F2): Mute/Unmute always; Leave channel on channels
    // only — a DM has no leave (you cannot exit your own DM).
    const actions = [
      { label: c.muted ? 'Unmute' : 'Mute', onSelect: () => void toggleMute(c) },
      ...(isDm ? [] : [{ label: 'Leave channel', danger: true, onSelect: () => void leave(c) }]),
    ]
    return (
      <div key={c.id} className="group relative flex items-center">
        <Link href={`/chat/${c.id}`}
          className={`flex min-w-0 flex-1 items-center justify-between gap-1.5 rounded-lg px-2 py-1.5 text-sm ${cls}`}>
          <span className="flex min-w-0 items-center gap-1.5">
            {isDm ? (
              <>
                <Avatar size={20} name={label} id={peerId ?? c.id} image={peerImage} presence={peerOnline ? 'active' : 'away'} />
                <span className="sr-only">{peerOnline ? 'Active' : 'Away'}</span>
              </>
            ) : c.isPrivate ? (
              <Lock size={15} aria-hidden className="shrink-0 text-subtle" />
            ) : (
              <Hash size={15} aria-hidden className="shrink-0 text-subtle" />
            )}
            <span className="truncate">{label}</span>
            {c.muted && <BellOff size={13} aria-label="Muted" className="shrink-0 text-subtle" />}
          </span>
          {c.mentions > 0 ? (
            <span className="ml-1 shrink-0 rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-on">{c.mentions}</span>
          ) : !c.muted && c.unread > 0 ? (
            <span className="ml-1 shrink-0 rounded-full bg-active px-1.5 text-[11px] font-bold text-muted">{c.unread}</span>
          ) : null}
        </Link>
        {/* Out-of-flow trigger: appearing on hover/focus-within never re-truncates
            the label or shifts the row. The opaque chip covers the badge zone the
            way Slack's row actions do. Hover/keyboard-only by design (NO
            pointer-coarse utilities — the v0.14.1 F1 lesson): touch users get the
            header ⋯ menu instead. The popover bounds itself to the rail's
            overflow-y-auto because menu.tsx treats clip ancestors as hard bounds. */}
        <span className="absolute right-0.5 top-1/2 z-10 hidden -translate-y-1/2 group-hover:block group-focus-within:block">
          <Menu label={`${label} actions`} button={<MoreHorizontal size={16} aria-hidden />} items={actions}
            buttonClassName="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface text-muted shadow-sm hover:bg-hover hover:text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
        </span>
      </div>
    )
  }

  return (
    <nav aria-label="Conversations" className="space-y-4 p-3">
      <section>
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">Channels</h2>
          {role !== 'guest' && <BrowseAndCreate />}
        </div>
        <div className="mt-1 space-y-0.5">{channels.map(row)}</div>
      </section>
      <section>
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">Direct messages</h2>
          <NewDmButton />
        </div>
        <div className="mt-1 space-y-0.5">{dms.map(row)}</div>
      </section>
    </nav>
  )
}
