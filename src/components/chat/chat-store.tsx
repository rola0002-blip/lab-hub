'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useEvents, type ClientEvent } from '@/components/use-events'

export type ChatUser = { id: string; name: string; role: string; image: string | null }
export type ConversationItem = {
  id: string; type: 'CHANNEL' | 'DM'; name: string | null; topic: string; isPrivate: boolean
  archived: boolean; muted: boolean; memberIds: string[]
  members: { id: string; image: string | null }[]
  unread: number; mentions: number; lastMessageAt: string | null
}

type ChatState = {
  conversations: ConversationItem[]
  users: ChatUser[]
  online: Set<string>
  selfId: string
  refresh: () => Promise<void>
  registerConversationHandler: (fn: (e: ClientEvent) => void) => () => void
}

const Ctx = createContext<ChatState | null>(null)
export function useChat(): ChatState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useChat outside ChatProvider')
  return v
}

export function dmName(item: { memberIds: string[] }, users: ChatUser[], selfId: string): string {
  const names = item.memberIds.filter((id) => id !== selfId).map((id) => users.find((u) => u.id === id)?.name ?? 'unknown')
  return names.join(', ') || 'Just you'
}

export function ChatProvider({ selfId, children }: { selfId: string; children: React.ReactNode }) {
  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [users, setUsers] = useState<ChatUser[]>([])
  const [online, setOnline] = useState<Set<string>>(new Set())
  const handlers = useRef(new Set<(e: ClientEvent) => void>())
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    const r = await fetch('/api/chat/conversations')
    if (r.ok) setConversations((await r.json()).conversations)
  }, [])

  useEffect(() => {
    // refresh() only setStates after awaiting fetch — async, never a synchronous cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    void fetch('/api/chat/users').then(async (r) => r.ok && setUsers((await r.json()).users))
    void fetch('/api/chat/presence').then(async (r) => r.ok && setOnline(new Set((await r.json()).online as string[])))
  }, [refresh])

  useEvents((e) => {
    for (const fn of handlers.current) fn(e)
    if (e.t === 'presence') {
      setOnline((prev) => {
        const next = new Set(prev)
        if (e.online) next.add(e.uid); else next.delete(e.uid)
        return next
      })
      return
    }
    if (e.t === 'msg' || e.t === 'read' || e.t === 'member' || e.t === 'reconnect') {
      if (debounce.current) clearTimeout(debounce.current)
      debounce.current = setTimeout(() => void refresh(), 250)
    }
  })

  const registerConversationHandler = useCallback((fn: (e: ClientEvent) => void) => {
    handlers.current.add(fn)
    return () => { handlers.current.delete(fn) }
  }, [])

  const value = useMemo(
    () => ({ conversations, users, online, selfId, refresh, registerConversationHandler }),
    [conversations, users, online, selfId, refresh, registerConversationHandler],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
