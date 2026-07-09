'use client'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useChat, dmName } from './chat-store'
import { BrowseAndCreate, NewDmButton } from './channel-dialogs'

export default function ConversationList({ role }: { role: string }) {
  const { conversations, users, online, selfId } = useChat()
  const params = useParams<{ conversationId?: string }>()
  const active = params?.conversationId
  const channels = conversations.filter((c) => c.type === 'CHANNEL' && !c.archived)
  const dms = conversations.filter((c) => c.type === 'DM')

  const row = (c: (typeof conversations)[number]) => {
    const isDm = c.type === 'DM'
    const label = isDm ? dmName(c, users, selfId) : `#${c.name}`
    const otherOnline = isDm && c.memberIds.some((id) => id !== selfId && online.has(id))
    return (
      <Link key={c.id} href={`/chat/${c.id}`}
        className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm ${
          c.id === active ? 'bg-accent/10 text-accent' : c.unread > 0 ? 'font-semibold text-gray-900 hover:bg-gray-100' : 'text-gray-700 hover:bg-gray-100'
        }`}>
        <span className="flex min-w-0 items-center gap-1.5">
          {isDm && <span className={`h-2 w-2 shrink-0 rounded-full ${otherOnline ? 'bg-green-500' : 'bg-gray-300'}`} />}
          <span className="truncate">{label}{c.isPrivate && ' 🔒'}</span>
        </span>
        {c.mentions > 0
          ? <span className="ml-1 rounded-full bg-accent px-1.5 text-[11px] font-bold text-white">{c.mentions}</span>
          : c.unread > 0 ? <span className="ml-1 rounded-full bg-gray-300 px-1.5 text-[11px] font-bold text-gray-700">{c.unread}</span> : null}
      </Link>
    )
  }

  return (
    <nav className="space-y-4 p-3">
      <section>
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Channels</h2>
          {role !== 'guest' && <BrowseAndCreate />}
        </div>
        <div className="mt-1 space-y-0.5">{channels.map(row)}</div>
      </section>
      <section>
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Direct messages</h2>
          <NewDmButton />
        </div>
        <div className="mt-1 space-y-0.5">{dms.map(row)}</div>
      </section>
    </nav>
  )
}
