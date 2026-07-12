'use client'
import { useSyncExternalStore } from 'react'
import { LayoutList, Columns3 } from 'lucide-react'

const KEY = 'colossus:issues:view'
function subscribe(cb: () => void) { window.addEventListener('storage', cb); return () => window.removeEventListener('storage', cb) }
function read(): 'list' | 'board' { try { return localStorage.getItem(KEY) === 'board' ? 'board' : 'list' } catch { return 'list' } }

export function useIssueView(): ['list' | 'board', (v: 'list' | 'board') => void] {
  const view = useSyncExternalStore(subscribe, read, () => 'list' as const)
  const set = (v: 'list' | 'board') => { try { localStorage.setItem(KEY, v) } catch {}; window.dispatchEvent(new StorageEvent('storage', { key: KEY })) }
  return [view, set]
}

export function ViewToggle() {
  const [view, set] = useIssueView()
  return (
    <div role="group" aria-label="View" className="inline-flex rounded-md border border-border">
      <button type="button" aria-pressed={view === 'list'} onClick={() => set('list')} className={`flex items-center gap-1 rounded-l-md px-2 py-1 text-sm ${view === 'list' ? 'bg-selected text-[var(--text-accent)]' : 'text-muted hover:bg-hover'}`}><LayoutList size={15} aria-hidden />List</button>
      <button type="button" aria-pressed={view === 'board'} onClick={() => set('board')} className={`flex items-center gap-1 rounded-r-md px-2 py-1 text-sm ${view === 'board' ? 'bg-selected text-[var(--text-accent)]' : 'text-muted hover:bg-hover'}`}><Columns3 size={15} aria-hidden />Board</button>
    </div>
  )
}
