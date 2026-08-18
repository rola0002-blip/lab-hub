'use client'
import { useSoundsEnabled } from './hooks/use-sounds'

export function SoundsToggle({ initial }: { initial: boolean }) {
  const { enabled, set } = useSoundsEnabled(initial)
  return (
    <button type="button" role="switch" aria-checked={enabled} aria-label="Notification sounds"
      onClick={() => set(!enabled)}
      className={`relative h-6 w-11 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] ${enabled ? 'border-transparent bg-accent' : 'border-border bg-active'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface transition-all ${enabled ? 'left-[1.375rem]' : 'left-0.5'}`} />
    </button>
  )
}
