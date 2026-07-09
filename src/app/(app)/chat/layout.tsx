import { requireUser } from '@/lib/session'
import { ChatProvider } from '@/components/chat/chat-store'
import ConversationList from '@/components/chat/conversation-list'

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  return (
    <ChatProvider selfId={user.id}>
      <div className="flex h-[calc(100vh-7rem)] gap-0 overflow-hidden rounded-xl border border-gray-200">
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-gray-200">
          <ConversationList role={user.role} />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </ChatProvider>
  )
}
