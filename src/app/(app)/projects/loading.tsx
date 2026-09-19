import { Skeleton } from '@/components/ui/skeleton'

// Route-level fallback while the projects page's server data resolves. Mirrors
// the review grid's shape (eyebrow + heading + New-project button, filter bar,
// then the sm:2/lg:3 card grid — six cards reads as a populated lab without
// implying a count the real grid must match).
export default function ProjectsLoading() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="h-4 w-20 rounded bg-active motion-safe:animate-pulse" />
          <div className="mt-1 h-8 w-24 rounded bg-active motion-safe:animate-pulse" />
        </div>
        <div className="h-9 w-32 rounded-md bg-active motion-safe:animate-pulse" />
      </div>
      <div className="h-9 w-44 rounded-md bg-active motion-safe:animate-pulse" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <section key={i} className="rounded-xl border border-border bg-surface p-4 shadow-xs">
            <div className="h-4 w-3/5 rounded bg-active motion-safe:animate-pulse" />
            <div className="mt-3 space-y-1.5">
              <Skeleton lines={2} />
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
