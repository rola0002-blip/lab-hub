import Link from 'next/link'

// Root 404: renders OUTSIDE the app shell (the root layout only) for URLs that
// match no route at all — self-contained, no sidebar, but on the same design
// tokens so it still tracks the theme.
export default function RootNotFound() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-2xl font-semibold text-default">Not found</p>
      <p className="max-w-sm text-sm text-muted">This page does not exist. If you followed a link here, it may be stale.</p>
      <Link href="/dashboard" className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-on transition-colors hover:bg-accent-hover">Go to dashboard</Link>
    </div>
  )
}
