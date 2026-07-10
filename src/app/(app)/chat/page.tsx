import { MessagesSquare } from 'lucide-react'
import SearchBox from '@/components/chat/search-box'
import { EmptyState } from '@/components/ui/empty-state'

export default function ChatIndexPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-200 p-3">
        <SearchBox align="left" />
      </div>
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={MessagesSquare}
          title="No conversation selected"
          hint="Pick a channel or direct message from the sidebar — or start a new one to get the conversation going."
        />
      </div>
    </div>
  )
}
