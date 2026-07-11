import { Skeleton } from '@/components/ui/skeleton'

// Route-level fallback for the equipment catalogue: eyebrow + heading + a grid of
// instrument-card placeholders (photo block + two text lines) matching the page.
export default function BookingLoading() {
  return (
    <div>
      <div className="h-3 w-20 rounded bg-active motion-safe:animate-pulse" />
      <div className="mt-2 h-7 w-40 rounded bg-active motion-safe:animate-pulse" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-surface p-4 shadow-xs">
            <div className="h-32 w-full rounded-lg bg-active motion-safe:animate-pulse" />
            <div className="mt-3"><Skeleton lines={2} /></div>
          </div>
        ))}
      </div>
    </div>
  )
}
