'use client'
import { usePathname } from 'next/navigation'

// Responsive chat shell. At md+ (≥768) it is byte-identical to the previous
// static layout: a fixed w-64 conversation-list rail beside the flex-1 message
// pane. Below md it becomes a Slack-style list/pane SWAP so there is never a
// second shrink-0 column forcing horizontal scroll at 320px:
//   • no conversation selected (/chat)      → list full-width, pane hidden
//   • a conversation open   (/chat/<cid>)    → pane full-width, list hidden
// The pane carries its own "Back to conversations" control (message-pane header,
// md:hidden) to return to the list. usePathname re-renders this client component
// on navigation, so the swap tracks the selected conversation.
export function ChatShell({ list, children }: { list: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname()
  const hasConversation = /^\/chat\/.+/.test(pathname)
  return (
    <div className="flex h-[calc(100dvh-7rem)] gap-0 overflow-hidden rounded-xl border border-border">
      <aside
        aria-label="Conversations"
        className={`${hasConversation ? 'hidden' : 'flex w-full'} flex-col border-r border-border md:flex md:w-64 md:shrink-0`}
      >
        {list}
      </aside>
      <div className={`${hasConversation ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col md:flex`}>{children}</div>
    </div>
  )
}
