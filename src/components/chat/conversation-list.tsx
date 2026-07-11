'use client'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Hash, Lock, BellOff } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { sortConversations } from '@/features/chat/sort'
import { useChat, dmName } from './chat-store'
import { BrowseAndCreate, NewDmButton } from './channel-dialogs'

export default function ConversationList({ role }: { role: string }) {
  const { conversations, users, online, selfId } = useChat()
  const params = useParams<{ conversationId?: string }>()
  const active = params?.conversationId
  const channels = sortConversations(conversations.filter((c) => c.type === 'CHANNEL' && !c.archived))
  const dms = sortConversations(conversations.filter((c) => c.type === 'DM'))

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
    return (
      <Link key={c.id} href={`/chat/${c.id}`}
        className={`flex items-center justify-between gap-1.5 rounded-lg px-2 py-1.5 text-sm ${cls}`}>
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
    )
  }

  return (
    <nav className="space-y-4 p-3">
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
