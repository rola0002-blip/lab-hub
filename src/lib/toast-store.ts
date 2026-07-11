// A tiny, framework-agnostic pub-sub store for transient toast notifications.
// Kept pure (no React) so it is unit-testable and so the <ToastHost /> wrapper
// (src/components/ui/toast.tsx) stays thin — it just binds this store to React
// via useSyncExternalStore. `getSnapshot` returns a reference that only changes
// when the toast list changes, which is exactly what useSyncExternalStore needs
// to avoid infinite re-render loops.

export type ToastAction = { label: string; onClick: () => void }
export type Toast = { id: string; message: string; action?: ToastAction }
export type ToastOptions = {
  action?: ToastAction
  // Auto-dismiss delay in ms; defaults to the store's default (~3s). A value
  // <= 0 makes the toast sticky (no auto-dismiss) — used for cases that must be
  // acted on explicitly.
  duration?: number
}

export type ToastStore = {
  subscribe(listener: () => void): () => void
  getSnapshot(): Toast[]
  add(message: string, opts?: ToastOptions): string
  dismiss(id: string): void
}

export function createToastStore(defaultDuration = 3000): ToastStore {
  let toasts: Toast[] = []
  const listeners = new Set<() => void>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let seq = 0

  const emit = () => { for (const l of listeners) l() }

  function dismiss(id: string): void {
    const timer = timers.get(id)
    if (timer) { clearTimeout(timer); timers.delete(id) }
    const next = toasts.filter((t) => t.id !== id)
    if (next.length === toasts.length) return // unknown id — no change, no notify
    toasts = next
    emit()
  }

  function add(message: string, opts: ToastOptions = {}): string {
    const id = `t${++seq}`
    toasts = [...toasts, { id, message, ...(opts.action ? { action: opts.action } : {}) }]
    const duration = opts.duration ?? defaultDuration
    if (duration > 0) timers.set(id, setTimeout(() => dismiss(id), duration))
    emit()
    return id
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot: () => toasts,
    add,
    dismiss,
  }
}

// App-wide singleton. `toast()` is the ergonomic global entry point callers use
// from any page; <ToastHost /> renders `toastStore`'s snapshot.
export const toastStore = createToastStore()
export function toast(message: string, opts?: ToastOptions): string {
  return toastStore.add(message, opts)
}
