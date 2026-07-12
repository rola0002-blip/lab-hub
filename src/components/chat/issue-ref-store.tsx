'use client'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { extractIssueRefNumbers } from '@/features/issues/identifier'
import type { RefData } from './issue-ref-pill'

const IssueRefContext = createContext<Map<number, RefData> | null>(null)
export function useIssueRefs(): Map<number, RefData> | null {
  return useContext(IssueRefContext)
}

// Pane-level batched issueRef resolution: `bodies` is the visible message set's
// raw bodies; the number set is derived in one useMemo; one debounced fetch per
// DISTINCT set (the key only changes when the numbers change, so scrolling or
// re-renders with the same refs never refetch). No per-pill mount effects, and
// state is set only after an awaited round-trip — the same shape as SearchBox's
// debounced fetch, so the set-state-in-effect / refs lint traps are never touched.
export function IssueRefProvider({ bodies, children }: { bodies: string[]; children: ReactNode }) {
  const key = useMemo(() => {
    const nums = new Set<number>()
    for (const b of bodies) for (const n of extractIssueRefNumbers(b)) nums.add(n)
    return [...nums].sort((a, b) => a - b).join(',')
  }, [bodies])
  const [refs, setRefs] = useState<Map<number, RefData>>(new Map())
  useEffect(() => {
    if (!key) return // no refs on screen — nothing to resolve
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/issues/refs?n=${key}`)
        if (!r.ok) return
        const d = await r.json() as { refs: (RefData & { number: number })[] }
        setRefs(new Map(d.refs.map((x) => [x.number, x])))
      } catch { /* transient — pills fall back to plain text */ }
    }, 150)
    return () => clearTimeout(t)
  }, [key])
  return <IssueRefContext.Provider value={refs}>{children}</IssueRefContext.Provider>
}
