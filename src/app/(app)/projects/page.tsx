import { FolderKanban } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

export default function ProjectsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-default">Projects</h1>
      <EmptyState icon={FolderKanban} title="No projects yet" hint="Group issues into projects to track progress." />
    </div>
  )
}
