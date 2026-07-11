import { ListTodo } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

export default function IssuesPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-default">Issues</h1>
      <EmptyState icon={ListTodo} title="No issues yet" hint="Create the first issue to start tracking research and lab work." />
    </div>
  )
}
