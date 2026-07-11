import { Inbox } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

export default function MyIssuesPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-default">My issues</h1>
      <EmptyState icon={Inbox} title="No issues yet" hint="Issues assigned to you will appear here." />
    </div>
  )
}
