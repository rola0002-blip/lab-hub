import { Skeleton } from '@/components/ui/skeleton'

// Route-level fallback while the people page's server data resolves. Mirrors the
// members list's shape (eyebrow + heading, then the divide-y card of avatar
// rows) — the admin-only invite form and pending-invitations section are not
// sketched, so the skeleton stays honest for the member view too.
export default function PeopleLoading() {
  return (
    <div>
      <div className="h-4 w-24 rounded bg-active motion-safe:animate-pulse" />
      <div className="mt-1 h-8 w-24 rounded bg-active motion-safe:animate-pulse" />
      <div className="mt-6 space-y-8">
        <section>
          <div className="h-5 w-20 rounded bg-active motion-safe:animate-pulse" />
          <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="p-3">
                <Skeleton avatar lines={1} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
