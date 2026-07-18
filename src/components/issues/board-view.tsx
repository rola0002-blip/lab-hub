'use client'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, useDroppable, closestCorners, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { ChevronRight } from 'lucide-react'
import { toast } from '@/lib/toast-store'
import { useEvents } from '@/components/use-events'
import { ISSUE_STATUSES, STATUS_LABEL } from '@/features/issues/status'
import { BOARD_COLLAPSE_KEY, parseCollapsed, serializeCollapsed } from '@/features/issues/board-collapse'
import { StatusIcon } from './status'
import { BoardCard } from './board-card'
import type { IssueDto } from '@/features/issues/issue-service'
import type { IssueStatus } from '@prisma/client'
import type { Role } from '@/lib/session'

// Collapse state persists in localStorage (lint-safe via useSyncExternalStore,
// same pattern as ViewToggle) so it survives the keyed remounts IssuesSurface
// performs on every server-truth change — a successful drag echoes an SSE
// refresh, and that remount must not revert the user's expand/collapse. The
// snapshot is the RAW string (a primitive, stable under Object.is, so no
// getSnapshot caching gymnastics); the Set derives from it in useMemo.
function subscribeCollapsed(cb: () => void) { window.addEventListener('storage', cb); return () => window.removeEventListener('storage', cb) }
function readCollapsedRaw(): string | null { try { return localStorage.getItem(BOARD_COLLAPSE_KEY) } catch { return null } }

function useBoardCollapse(): [Set<IssueStatus>, (s: Set<IssueStatus>) => void] {
  const raw = useSyncExternalStore(subscribeCollapsed, readCollapsedRaw, () => null)
  const collapsed = useMemo(() => parseCollapsed(raw), [raw])
  const set = (s: Set<IssueStatus>) => {
    try { localStorage.setItem(BOARD_COLLAPSE_KEY, serializeCollapsed(s)) } catch {}
    window.dispatchEvent(new StorageEvent('storage', { key: BOARD_COLLAPSE_KEY }))
  }
  return [collapsed, set]
}

export function BoardView({ initial, role, today, timezone }: { initial: IssueDto[]; role: Role; today: string; timezone: string }) {
  const router = useRouter()
  const readOnly = role === 'guest'
  const [issues, setIssues] = useState(initial)
  const [collapsed, setCollapsed] = useBoardCollapse() // default: Canceled collapsed (board-collapse.ts)

  useEvents((e) => { if (e.t === 'issue' || e.t === 'issue_move' || e.t === 'issue_comment') router.refresh() })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }), // space to lift, arrows to move, space to drop
  )
  const byStatus = useMemo(() => {
    const m = new Map<IssueStatus, IssueDto[]>()
    for (const s of ISSUE_STATUSES) m.set(s, [])
    for (const i of [...issues].sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))) m.get(i.status)!.push(i)
    return m
  }, [issues])

  async function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id)
    const overId = e.over ? String(e.over.id) : null
    if (!overId) return
    // The drop target is either a card (→ its column, positioned around it) or a column droppable id ("col:STATUS").
    const overStatus: IssueStatus = overId.startsWith('col:') ? (overId.slice(4) as IssueStatus) : issues.find((i) => i.id === overId)!.status
    const column = (byStatus.get(overStatus) ?? []).filter((i) => i.id !== activeId)
    const overIdx = overId.startsWith('col:') ? column.length : column.findIndex((i) => i.id === overId)
    const insertAt = overIdx < 0 ? column.length : overIdx
    const prevId = insertAt > 0 ? column[insertAt - 1].id : null
    const nextId = insertAt < column.length ? column[insertAt].id : null

    const before = issues // onDragEnd is recreated each render, so this closes over current state (rollback target)
    // Optimistic: move locally now.
    setIssues((prev) => prev.map((i) => (i.id === activeId ? { ...i, status: overStatus, rank: nextId ? '' : 'zzzzz' } : i)))
    try {
      const res = await fetch(`/api/issues/${activeId}/move`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: overStatus, prevId, nextId }),
      })
      if (!res.ok) throw new Error('move failed')
      const { issue } = await res.json()
      setIssues((prev) => prev.map((i) => (i.id === activeId ? issue as IssueDto : i)))
    } catch {
      setIssues(before) // rollback
      toast('Could not move that issue. Please try again.')
    }
  }

  const columns = readOnly
    ? <BoardColumns byStatus={byStatus} collapsed={collapsed} setCollapsed={setCollapsed} readOnly today={today} timezone={timezone} />
    : (
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
        <BoardColumns byStatus={byStatus} collapsed={collapsed} setCollapsed={setCollapsed} readOnly={false} today={today} timezone={timezone} />
      </DndContext>
    )
  // Mobile: horizontal snap scroll (§6.7). Desktop: side-by-side columns.
  return <div className="flex gap-3 overflow-x-auto pb-2 [scroll-snap-type:x_mandatory]">{columns}</div>
}

// An empty column still needs its own droppable so a card can be dropped into it
// (SortableContext only makes the cards themselves droppable). The `col:` over-id
// is handled by onDragEnd above.
function ColumnDroppable({ status, children }: { status: IssueStatus; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id: `col:${status}` })
  return <div ref={setNodeRef} className="flex min-h-8 flex-col gap-2">{children}</div>
}

function BoardColumns({ byStatus, collapsed, setCollapsed, readOnly, today, timezone }: {
  byStatus: Map<IssueStatus, IssueDto[]>; collapsed: Set<IssueStatus>; setCollapsed: (s: Set<IssueStatus>) => void; readOnly: boolean
  today: string; timezone: string
}) {
  return (
    <>
      {ISSUE_STATUSES.map((status) => {
        const items = byStatus.get(status) ?? []
        const isCollapsed = collapsed.has(status)
        return (
          <section key={status} aria-label={STATUS_LABEL[status]} data-col-status={status}
            className={`flex shrink-0 flex-col gap-2 rounded-xl bg-surface-sunken p-2 [scroll-snap-align:start] ${isCollapsed ? 'w-12' : 'w-72'}`}>
            <button type="button" aria-expanded={!isCollapsed}
              onClick={() => { const n = new Set(collapsed); if (isCollapsed) n.delete(status); else n.add(status); setCollapsed(n) }}
              className="flex items-center gap-2 rounded-md px-1 py-0.5 text-xs font-semibold text-muted hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
              <ChevronRight size={14} aria-hidden className={isCollapsed ? '' : 'rotate-90'} />
              <StatusIcon status={status} size={14} />{!isCollapsed && <><span>{STATUS_LABEL[status]}</span><span className="text-subtle">{items.length}</span></>}
            </button>
            {!isCollapsed && (
              <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                <ColumnDroppable status={status}>
                  {items.map((i) => <BoardCard key={i.id} issue={i} disabled={readOnly} today={today} timezone={timezone} />)}
                </ColumnDroppable>
              </SortableContext>
            )}
          </section>
        )
      })}
    </>
  )
}
