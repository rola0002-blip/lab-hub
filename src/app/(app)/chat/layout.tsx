import { requireUser } from '@/lib/session'
import { requireSetup } from '@/lib/org'
import ConversationList from '@/components/chat/conversation-list'
import SearchBox from '@/components/chat/search-box'
import { ChatShell } from '@/components/chat/chat-shell'

// ChatProvider now lives in the app-shell layout ((app)/layout.tsx) so the
// global ⌘K palette shares one store; this layout renders the chat rail with the
// single message-search entry pinned above the scrollable conversation list (so
// its results dropdown is never clipped by the list's overflow). ChatShell owns
// the responsive layout: a static rail at md+ (unchanged) and a list/pane swap
// below md so a 320px viewport never grows a second shrink-0 column.
export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  // Workspace name brands the message-search placeholder ("Search LabHub"),
  // matching the ⌘K palette. requireSetup was already enforced by the parent app
  // layout, so this is a cheap re-read of the single Organization row.
  const org = await requireSetup()
  return (
    <ChatShell
      list={
        <>
          <div className="border-b border-border p-2">
            <SearchBox orgName={org.name} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ConversationList role={user.role} />
          </div>
        </>
      }
    >
      {children}
    </ChatShell>
  )
}
