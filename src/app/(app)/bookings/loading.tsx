import { Skeleton } from '@/components/ui/skeleton'

// Route-level fallback while the my-bookings page's server data resolves.
// Mirrors the page's two stacked sections (Upcoming, Past & closed), each a
// heading over the divide-y card of booking rows.
export default function BookingsLoading() {
  return (
    <div>
      <div className="h-4 w-32 rounded bg-active motion-safe:animate-pulse" />
      <div className="mt-1 h-8 w-40 rounded bg-active motion-safe:animate-pulse" />
      <div className="mt-6 space-y-8">
        {[3, 4].map((rows, s) => (
          <section key={s}>
            <div className="h-5 w-28 rounded bg-active motion-safe:animate-pulse" />
            <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
              {Array.from({ length: rows }).map((_, i) => (
                <li key={i} className="p-3">
                  <Skeleton lines={1} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
