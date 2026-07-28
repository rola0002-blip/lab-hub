'use client'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { X } from 'lucide-react'

// The filter keys this bar owns (the filter-bar.tsx idiom): "Clear" removes exactly
// these and preserves any other query param, and only appears when one is active.
const KEYS = ['health', 'attention']

export function ProjectFilterBar() {
  const router = useRouter(); const pathname = usePathname(); const sp = useSearchParams()
  function set(key: string, value: string) {
    const next = new URLSearchParams(sp.toString())
    if (value) next.set(key, value); else next.delete(key)
    router.replace(`${pathname}?${next.toString()}`)
  }
  function clearAll() {
    const next = new URLSearchParams(sp.toString())
    for (const k of KEYS) next.delete(k)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }
  const selectCls = 'rounded-md border border-border bg-surface px-2 py-1 text-sm text-default hover:border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'
  const hasFilters = KEYS.some((k) => sp.get(k))
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter projects">
      {/* Values are BUCKET names, not stored ProjectHealth — parseProjectFilters
          degrades anything unknown to no-filter (spec §4.7). */}
      <select aria-label="Health" value={sp.get('health') ?? ''} onChange={(e) => set('health', e.target.value)} className={selectCls}>
        <option value="">Any health</option>
        <option value="off_track">Off track</option>
        <option value="at_risk">At risk</option>
        <option value="no_update">No update</option>
        <option value="on_track">On track</option>
      </select>
      <label className="inline-flex items-center gap-1.5 text-sm text-default">
        <input type="checkbox" checked={sp.get('attention') === '1'} onChange={(e) => set('attention', e.target.checked ? '1' : '')}
          className="rounded border-border accent-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
        Needs attention
      </label>
      {hasFilters && (
        <button type="button" onClick={clearAll}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm text-muted hover:bg-hover hover:text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
          <X size={14} aria-hidden />Clear
        </button>
      )}
    </div>
  )
}
