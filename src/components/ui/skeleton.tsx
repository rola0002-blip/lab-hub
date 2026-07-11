// A shimmer placeholder for loading states. Pure/presentational (no hooks), so it
// can render inside Server Component `loading.tsx` fallbacks as well as client
// panes. `avatar` adds a leading rounded-square block matching the 36px avatar;
// `lines` draws that many text bars (the last one is shortened to read as a line
// tail). The pulse is `motion-safe` only — reduced-motion users get static bars.
export function Skeleton({ lines = 1, avatar = false, className }: {
  lines?: number
  avatar?: boolean
  className?: string
}) {
  return (
    <div aria-hidden className={`flex gap-2 ${className ?? ''}`}>
      {avatar && (
        <span className="h-9 w-9 shrink-0 rounded-[var(--radius-avatar)] bg-active motion-safe:animate-pulse" />
      )}
      <div className="min-w-0 flex-1 space-y-2 py-1">
        {Array.from({ length: lines }).map((_, i) => (
          <span
            key={i}
            className="block h-3 rounded bg-active motion-safe:animate-pulse"
            style={{ width: i === lines - 1 && lines > 1 ? '55%' : '100%' }}
          />
        ))}
      </div>
    </div>
  )
}
