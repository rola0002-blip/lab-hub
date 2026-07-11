import { Skeleton } from '@/components/ui/skeleton'

// Route-level fallback shown while the dashboard's server data resolves. Mirrors
// the page shape (eyebrow + heading + two cards of rows) so the layout doesn't
// jump when content lands.
export default function DashboardLoading() {
  return (
    <div>
      <div className="h-3 w-24 rounded bg-active motion-safe:animate-pulse" />
      <div className="mt-2 h-7 w-56 rounded bg-active motion-safe:animate-pulse" />
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <section key={i} className="rounded-xl border border-border bg-surface p-4 shadow-xs">
            <div className="h-4 w-40 rounded bg-active motion-safe:animate-pulse" />
            <div className="mt-3 space-y-1.5">
              {Array.from({ length: 3 }).map((_, j) => <Skeleton key={j} lines={1} />)}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
