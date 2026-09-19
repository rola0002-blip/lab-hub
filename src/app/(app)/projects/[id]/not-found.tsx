import Link from 'next/link'
import { SearchX } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

// Scoped to the id segment: notFound() on an unknown project renders this
// styled 404 inside the shell (deleted project or stale link).
export default function ProjectNotFound() {
  return (
    <EmptyState icon={SearchX} title="Not found"
      hint="No project matches this link — it may have been deleted."
      action={<Link href="/dashboard" className="text-sm font-medium text-[var(--text-accent)] hover:underline">Go to dashboard</Link>} />
  )
}
