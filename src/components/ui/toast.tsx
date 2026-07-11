'use client'
import { useSyncExternalStore } from 'react'
import { X } from 'lucide-react'
import { toastStore } from '@/lib/toast-store'

// Re-export the global entry point so callers import both the host and the
// trigger from one place: `import { ToastHost, toast } from '@/components/ui/toast'`.
export { toast } from '@/lib/toast-store'
export type { Toast, ToastAction, ToastOptions } from '@/lib/toast-store'

// Mounted once in the app shell ((app)/layout.tsx). A thin React binding over the
// pure toast store — all queue/timeout logic lives in src/lib/toast-store.ts. The
// server snapshot is the same empty-on-init array, so hydration is stable.
export function ToastHost() {
  const toasts = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot, toastStore.getSnapshot)

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-default shadow-menu motion-safe:animate-toast-in"
        >
          <span className="min-w-0 flex-1">{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => { t.action!.onClick(); toastStore.dismiss(t.id) }}
              className="shrink-0 rounded-md px-2 py-1 text-sm font-semibold text-accent transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]"
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => toastStore.dismiss(t.id)}
            className="shrink-0 rounded p-1 text-subtle transition-colors hover:bg-hover hover:text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  )
}
