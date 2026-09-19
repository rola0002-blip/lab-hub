import Link from 'next/link'
import { SearchX } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

// Segment 404 for any (app) URL that matches no route below this boundary —
// renders inside the shell, so a stray link keeps the sidebar instead of
// dumping the user onto the bare Next 404 page.
export default function AppNotFound() {
  return (
    <EmptyState icon={SearchX} title="Not found"
      hint="This page does not exist — it may have been deleted, or the link is stale."
      action={<Link href="/dashboard" className="text-sm font-medium text-[var(--text-accent)] hover:underline">Go to dashboard</Link>} />
  )
}
