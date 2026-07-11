import { FolderKanban } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <div>
      <h1 className="text-lg font-semibold text-default">{id}</h1>
      <EmptyState icon={FolderKanban} title="Project detail" hint="This view is completed in a later task." />
    </div>
  )
}
