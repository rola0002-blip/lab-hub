'use client'
import { useEffect, useRef } from 'react'
import { useChat } from '@/components/chat/chat-store'
import { sumUnread } from '@/features/chat/unread'
import { applyAppBadge } from '@/lib/app-badge'

// Teams-style "(N)" unread-chats count in the TAB TITLE (wave-6). Mounted once
// in the app shell inside ChatProvider. Same live derivation as the sidebar
// Chat badge (sumUnread over conversations; muted rows count 0 — the
// unread.ts contract), so tab and badge can never disagree once the store has
// loaded. Unlike the sidebar, there is NO SSR-seed fallback here: the badge's
// seed is a SERVER prop threaded to <Sidebar>, and the tab title has no
// first-paint urgency — before the store loads (~1s) the title stays at its
// base, which is indistinguishable from "no unreads".
export function ChatTitleBadge() {
  const { conversations } = useChat()
  const base = useRef<string | null>(null)
  useEffect(() => {
    // Capture the base (server-rendered) title; it is the restore target.
    // Falsy check, not null: an empty capture means the title hasn't landed
    // yet, so we retry the capture on later runs until it does.
    if (!base.current) base.current = document.title
    const n = sumUnread(conversations)
    // Same n drives the installed-PWA launcher badge (no-op where unsupported).
    applyAppBadge(n)
    // A streaming shell (loading.tsx) can hydrate before the document's
    // <title> commits — an empty capture is not a base to prefix or restore.
    // Skip the write; the capture above retries on the next store change, by
    // which time the title has landed — writing '' here would blank the tab.
    if (!base.current) return
    document.title = n > 0 ? `(${n}) ${base.current}` : base.current
  }, [conversations])
  return null
}
