import { Skeleton } from '@/components/ui/skeleton'

// Route-level fallback while the issues page's server data resolves. Mirrors the
// board's shape (heading + New-issue button, FilterBar selects, then the six
// sunken columns with two cards each — ISSUE_STATUSES is six wide, not five) so
// the landing doesn't reflow when content replaces it.
export default function IssuesLoading() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="h-8 w-20 rounded bg-active motion-safe:animate-pulse" />
        <div className="h-9 w-24 rounded-md bg-active motion-safe:animate-pulse" />
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-9 w-28 rounded-md bg-active motion-safe:animate-pulse" />
        ))}
      </div>
      <div className="space-y-3">
        <div className="flex justify-end">
          <div className="h-8 w-28 rounded-md bg-active motion-safe:animate-pulse" />
        </div>
        <div className="flex gap-3 overflow-hidden pb-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <section key={i} className="flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-surface-sunken p-2">
              <div className="h-4 w-24 rounded bg-active motion-safe:animate-pulse" />
              {Array.from({ length: 2 }).map((_, j) => (
                <div key={j} className="rounded-lg border border-border bg-surface p-3 shadow-xs">
                  <Skeleton lines={2} />
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
