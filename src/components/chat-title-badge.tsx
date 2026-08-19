'use client'
import { useEffect, useRef } from 'react'
import { useChat } from '@/components/chat/chat-store'
import { sumUnread } from '@/features/chat/unread'

// Teams-style "(N)" unread-chats count in the TAB TITLE (wave-6). Mounted once
// in the app shell inside ChatProvider. Same derivation as the sidebar Chat
// badge (sidebar.tsx — sumUnread over live conversations with the SSR seed as
// pre-load fallback), so tab and badge can never disagree; muted rows count 0
// but a mention in a muted room still bells (the unread.ts contract).
export function ChatTitleBadge() {
  const { conversations, unread } = useChat()
  const base = useRef<string | null>(null)
  useEffect(() => {
    // Capture the server-rendered title once; it is the restore target.
    if (base.current === null) base.current = document.title
    const n = conversations.length > 0 ? sumUnread(conversations) : unread
    document.title = n > 0 ? `(${n}) ${base.current}` : base.current
  }, [conversations, unread])
  return null
}
