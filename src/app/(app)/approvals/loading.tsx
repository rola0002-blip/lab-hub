import { Skeleton } from '@/components/ui/skeleton'

// Route-level fallback while the approvals queue's server data resolves. Mirrors
// the queue's shape (eyebrow + heading, then the stack of pending-request
// cards) so the page doesn't jump when the real rows land.
export default function ApprovalsLoading() {
  return (
    <div>
      <div className="h-4 w-32 rounded bg-active motion-safe:animate-pulse" />
      <div className="mt-1 h-8 w-44 rounded bg-active motion-safe:animate-pulse" />
      <ul className="mt-6 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="rounded-xl border border-border bg-surface p-4 shadow-xs">
            <Skeleton avatar lines={2} />
          </li>
        ))}
      </ul>
    </div>
  )
}
