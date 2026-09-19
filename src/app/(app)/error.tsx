'use client'

// Segment error boundary for every authed page: a thrown render lands here
// INSIDE the app shell (the (app) layout wraps this boundary), so the sidebar
// and header survive and `reset` re-renders the failed segment in place.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-4 p-8">
      <h1 className="text-xl font-semibold text-default">Something went wrong</h1>
      <p className="text-sm text-muted">{error.digest ? `Reference: ${error.digest}` : 'Try again — if it keeps happening, tell us via Feedback.'}</p>
      <button onClick={reset} className="rounded-md bg-accent px-3 py-2 font-medium text-accent-on hover:bg-accent-hover">Try again</button>
    </div>
  )
}
