import { ListTodo } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

export default async function IssueDetailPage({ params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await params
  return (
    <div>
      <h1 className="text-lg font-semibold text-default">{identifier}</h1>
      <EmptyState icon={ListTodo} title="Issue detail" hint="This view is completed in a later task." />
    </div>
  )
}
