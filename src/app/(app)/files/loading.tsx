import { Skeleton } from '@/components/ui/skeleton'

// Route-level fallback while the files page's server data resolves. Mirrors the
// workspace shape: eyebrow + heading, then the lg rail (13rem of folder rows)
// beside the search field and the document listing rows.
export default function FilesLoading() {
  return (
    <div>
      <div className="h-4 w-20 rounded bg-active motion-safe:animate-pulse" />
      <div className="mt-1 h-8 w-16 rounded bg-active motion-safe:animate-pulse" />
      <div className="mt-4 grid gap-4 lg:grid-cols-[13rem_1fr]">
        <aside className="hidden space-y-1 lg:block">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-9 rounded-md bg-active motion-safe:animate-pulse" />
          ))}
        </aside>
        <section className="min-w-0">
          <div className="h-9 rounded-md bg-active motion-safe:animate-pulse" />
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface shadow-xs">
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
