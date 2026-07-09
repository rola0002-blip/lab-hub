'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useChat } from './chat-store'
import MessageItem, { type Msg } from './message-item'
import Composer from './composer'
import ThreadPanel from './thread-panel'
import ConversationMenu from './conversation-menu'
import SearchBox from './search-box'

type Props = {
  conversationId: string
  conversationType: 'CHANNEL' | 'DM'
  channelName: string | null
  archived: boolean
  selfRole: string
  manage: boolean
  memberIds: string[]
}

export default function MessagePane({ conversationId, conversationType, channelName, archived, selfRole, manage, memberIds }: Props) {
  const { users, selfId, registerConversationHandler } = useChat()
  const [messages, setMessages] = useState<Msg[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [threadRoot, setThreadRoot] = useState<string | null>(null)
  const [typing, setTyping] = useState<string | null>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const firstLoad = useRef(true)

  const markRead = useCallback(() => void fetch(`/api/chat/conversations/${conversationId}/read`, { method: 'POST' }), [conversationId])

  const loadLatest = useCallback(async () => {
    const r = await fetch(`/api/chat/conversations/${conversationId}/messages`)
    if (!r.ok) return
    const d = await r.json()
    setMessages(d.messages); setHasMore(d.hasMore)
    markRead()
  }, [conversationId, markRead])

  // loadLatest only setStates after awaiting fetch — async, never a synchronous cascading render.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadLatest() }, [loadLatest])

  // Reset the first-load flag when the conversation changes so the next load opens at newest.
  useEffect(() => { firstLoad.current = true }, [conversationId])

  const remove = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id))
  }, [])

  const upsert = useCallback((msg: Msg) => {
    setMessages((prev) => {
      // A real message replaces the sender's optimistic temp (matched by author+body).
      if (!msg.id.startsWith('tmp-')) {
        const tmpIdx = prev.findIndex((m) => m.id.startsWith('tmp-') && m.author.id === msg.author.id && m.body === msg.body)
        if (tmpIdx >= 0) prev = [...prev.slice(0, tmpIdx), ...prev.slice(tmpIdx + 1)]
      }
      const i = prev.findIndex((m) => m.id === msg.id)
      if (i >= 0) return [...prev.slice(0, i), msg, ...prev.slice(i + 1)]
      if (msg.parentId) {
        // thread reply: bump the root's replyCount instead of appending to the main list
        return prev.map((m) => (m.id === msg.parentId ? { ...m, replyCount: m.replyCount + 1 } : m))
      }
      return [...prev, msg]
    })
  }, [])

  useEffect(() => registerConversationHandler((e) => {
    if (e.t === 'reconnect') { void loadLatest(); return }
    if (!('cid' in e) || e.cid !== conversationId) return
    if (e.t === 'msg' || e.t === 'msg_edit' || e.t === 'msg_del' || e.t === 'rx') {
      void fetch(`/api/chat/messages/${e.mid}`).then(async (r) => {
        if (r.ok) { upsert((await r.json()).message); markRead() }
      })
    }
    if (e.t === 'typing') {
      setTyping(e.name)
      if (typingTimer.current) clearTimeout(typingTimer.current)
      typingTimer.current = setTimeout(() => setTyping(null), 4000)
    }
  }), [conversationId, registerConversationHandler, loadLatest, upsert, markRead])

  useEffect(() => { // first load opens at newest unconditionally; afterwards stick to bottom only when near it
    const el = scroller.current
    if (!el) return
    if (firstLoad.current && messages.length) { el.scrollTop = el.scrollHeight; firstLoad.current = false; return }
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTop = el.scrollHeight
  }, [messages])

  async function loadEarlier() {
    if (!messages.length) return
    const r = await fetch(`/api/chat/conversations/${conversationId}/messages?before=${messages[0].id}`)
    if (!r.ok) return
    const d = await r.json()
    setMessages((prev) => [...d.messages, ...prev]); setHasMore(d.hasMore)
  }

  const title = conversationType === 'DM' ? 'Direct message' : `#${channelName}`
  const names = new Map(users.map((u) => [u.id, u.name]))

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-gray-200 px-4 py-2">
          <h1 className="min-w-0 flex-1 truncate font-semibold">{title}</h1>
          <SearchBox />
          <ConversationMenu conversationId={conversationId} conversationType={conversationType}
            channelName={channelName} archived={archived} manage={manage} />
        </header>
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          {hasMore && <button onClick={loadEarlier} className="mx-auto my-2 block rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600">Load earlier</button>}
          {messages.map((m, i) => (
            <MessageItem key={m.id} msg={m} prev={messages[i - 1]} names={names} selfId={selfId} selfRole={selfRole}
              onUpdated={upsert} onOpenThread={() => setThreadRoot(m.id)} />
          ))}
          {typing && <p className="px-2 py-1 text-xs italic text-gray-400">{typing} is typing…</p>}
        </div>
        {archived
          ? <p className="border-t border-gray-200 p-3 text-sm text-gray-500">This conversation is archived.</p>
          : <Composer conversationId={conversationId} selfRole={selfRole} memberIds={memberIds} onSent={upsert} onRemove={remove} />}
      </div>
      {threadRoot && (
        <ThreadPanel rootId={threadRoot} conversationId={conversationId} names={names} memberIds={memberIds} selfId={selfId} selfRole={selfRole}
          onClose={() => setThreadRoot(null)} />
      )}
    </div>
  )
}
