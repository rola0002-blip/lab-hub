import { MessagesSquare } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

export default function ChatIndexPage() {
  return (
    <div className="flex h-full flex-1 items-center justify-center">
      <EmptyState
        icon={MessagesSquare}
        title="No conversation selected"
        hint="Pick a channel or direct message from the sidebar — or start a new one to get the conversation going."
      />
    </div>
  )
}
