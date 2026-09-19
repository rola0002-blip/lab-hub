import Link from 'next/link'
import { SearchX } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

// Scoped to the identifier segment: notFound() on an unknown LAB-n (deleted
// issue, typo'd number, stale link) renders this styled 404 inside the shell.
export default function IssueNotFound() {
  return (
    <EmptyState icon={SearchX} title="Not found"
      hint="No issue matches this identifier — it may have been deleted, or the number is off."
      action={<Link href="/dashboard" className="text-sm font-medium text-[var(--text-accent)] hover:underline">Go to dashboard</Link>} />
  )
}
