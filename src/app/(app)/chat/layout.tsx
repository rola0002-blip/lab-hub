import { requireUser } from '@/lib/session'
import ConversationList from '@/components/chat/conversation-list'
import SearchBox from '@/components/chat/search-box'

// ChatProvider now lives in the app-shell layout ((app)/layout.tsx) so the
// global ⌘K palette shares one store; this layout renders the chat rail with the
// single message-search entry pinned above the scrollable conversation list (so
// its results dropdown is never clipped by the list's overflow).
export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  return (
    <div className="flex h-[calc(100vh-7rem)] gap-0 overflow-hidden rounded-xl border border-border">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border">
        <div className="border-b border-border p-2">
          <SearchBox />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ConversationList role={user.role} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
