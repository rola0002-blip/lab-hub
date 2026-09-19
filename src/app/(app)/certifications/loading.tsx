// Route-level fallback while the certifications page's server data resolves.
// Mirrors the page's shape (eyebrow + heading, the link-tab rail, then the
// matrix panel — a first-column stub per row plus the equipment columns, the
// table idiom the Matrix itself renders).
export default function CertificationsLoading() {
  return (
    <div>
      <div className="h-4 w-40 rounded bg-active motion-safe:animate-pulse" />
      <div className="mt-1 h-8 w-44 rounded bg-active motion-safe:animate-pulse" />
      <div className="mt-4 flex flex-wrap gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-8 w-24 rounded-md border border-border bg-surface motion-safe:animate-pulse" />
        ))}
      </div>
      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
        {Array.from({ length: 6 }).map((_, r) => (
          <div key={r} className="flex divide-x divide-border border-b border-border last:border-b-0">
            {Array.from({ length: 5 }).map((_, c) => (
              <div key={c} className={`p-2.5 ${c === 0 ? 'w-40 shrink-0' : 'flex-1'}`}>
                <div className="h-3 rounded bg-active motion-safe:animate-pulse" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
