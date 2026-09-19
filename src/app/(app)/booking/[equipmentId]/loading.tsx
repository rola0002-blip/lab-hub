import { Skeleton } from '@/components/ui/skeleton'

// Route-level fallback while the equipment page's server data resolves. Mirrors
// the booking page's shape: eyebrow + equipment name + the week-stepping
// controls, then the md row of the schedule (a day-header band over the hour
// rows of the week grid) beside the fixed-width Policy aside.
export default function EquipmentLoading() {
  return (
    <div>
      <div className="h-4 w-24 rounded bg-active motion-safe:animate-pulse" />
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <div className="h-8 w-44 rounded bg-active motion-safe:animate-pulse" />
        <div className="h-8 w-72 rounded-md bg-active motion-safe:animate-pulse" />
      </div>
      <div className="mt-4 flex flex-col gap-6 md:flex-row">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex gap-1 pb-1">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-6 flex-1 rounded bg-active motion-safe:animate-pulse" />
            ))}
          </div>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-7 rounded bg-active motion-safe:animate-pulse" />
          ))}
        </div>
        <aside className="w-full shrink-0 rounded-xl border border-border bg-surface p-4 shadow-xs md:w-64">
          <div className="h-4 w-16 rounded bg-active motion-safe:animate-pulse" />
          <div className="mt-3 space-y-1.5">
            <Skeleton lines={5} />
          </div>
        </aside>
      </div>
    </div>
  )
}
