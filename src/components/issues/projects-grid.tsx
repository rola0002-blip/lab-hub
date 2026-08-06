'use client'
import { useMemo, useState } from 'react'
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
  type Announcements, type DragEndEvent, type ScreenReaderInstructions,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowUpDown, GripVertical } from 'lucide-react'
import { Menu } from '@/components/ui/menu'
import { moveProjectAction } from '@/app/(app)/issues/actions'
import { moveTargets, type MoveTarget } from '@/features/issues/project-order'
import { rankBetween } from '@/features/issues/rank'
import { toast } from '@/lib/toast-store'
import { ProjectCard } from './project-card'
import type { ProjectDto } from '@/features/issues/project-service'

// One source of truth for the /projects card grid: the arranged review grid below
// and the closed grid in page.tsx must stay visually identical.
export const PROJECT_GRID_CLASS = 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3'

// The prop type is `{ draggable: string }`, not a bare string.
const screenReaderInstructions: ScreenReaderInstructions = {
  draggable: 'To pick up a project card, press space or enter. Use the arrow keys to move it, space or enter to drop, escape to cancel.',
}

// Never rejects (it try/catches every failure class itself), so callers `void` it.
type Commit = (id: string, target: MoveTarget) => Promise<void>

export function ProjectsGrid({ projects, timezone, today, canArrange }: {
  projects: ProjectDto[]; timezone: string; today: string; canArrange: boolean
}) {
  // Seeded once; only the handlers below mutate it. Server truth re-enters by
  // remount — the page keys this component on projectOrderSignature().
  const [items, setItems] = useState(projects)
  // Byte-order comparison, matching `Project.rank COLLATE "C"` in Postgres.
  const sorted = useMemo(() => [...items].sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0)), [items])
  const ids = useMemo(() => sorted.map((p) => p.id), [sorted])
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }), // space to lift, arrows to move, space to drop
  )

  // The single mutation path for BOTH drops and the Move menu.
  const commit: Commit = async (id, { prevId, nextId }) => {
    const snapshot = items // recreated each render, so this is the current state (rollback target)
    try {
      // rankBetween throws on non-strictly-ordered bounds (a stale neighbour pair
      // racing a concurrent move). Skip only the optimistic paint in that case —
      // the action still runs and the server's own rank is authoritative.
      const rankOf = (pid: string | null): string | null => (pid ? items.find((p) => p.id === pid)?.rank ?? null : null)
      const optimistic = rankBetween(rankOf(prevId), rankOf(nextId))
      setItems((prev) => prev.map((p) => (p.id === id ? { ...p, rank: optimistic } : p)))
    } catch { /* no optimistic paint; the mutation below still runs */ }
    // Rollback covers EVERY failure class, not just `!r.ok` (board-view.tsx:70–83).
    // `run()` in actions.ts rethrows anything that is not a PolicyError, and the
    // server-action call itself rejects on network failure — a `.then`-only branch
    // would leave the optimistic move painted over a mutation that never landed.
    try {
      const r = await moveProjectAction({ projectId: id, prevId, nextId })
      if (!r.ok) throw new Error(r.message)
      setItems((prev) => prev.map((p) => (p.id === id ? r.data : p)))
    } catch {
      setItems(snapshot)
      toast('Could not move that project. Please try again.')
    }
  }

  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id)
    const overId = e.over ? String(e.over.id) : null
    if (!overId || overId === activeId) return
    // `oi` is the over-card's index in the FULL sorted order (active still included).
    // dnd-kit previews the drop as arrayMove(items, activeIndex, overIndex) — the
    // active card lands AT `overIndex` — so inserting at `oi` into the list WITHOUT
    // the active id reproduces the preview in both directions: dragging forward, the
    // over-card sits at `oi-1` in `column` (so `oi` is just after it); dragging
    // backward it sits at `oi` (so `oi` is just before it). Deliberately NOT the
    // board's over-index-in-column computation, which is off by one on forward drags.
    const oi = ids.indexOf(overId)
    if (oi < 0) return
    const column = ids.filter((id) => id !== activeId)
    const insertAt = oi
    void commit(activeId, { prevId: column[insertAt - 1] ?? null, nextId: column[insertAt] ?? null })
  }

  // Announcements name the project and give 1-based positions in the current
  // visual order — never raw ids. The over/dropped wording differs on purpose:
  // the keyboard journey waits on the distinct "dropped at" line.
  const nameOf = (id: string | number) => sorted.find((p) => p.id === String(id))?.name ?? 'Project'
  const posOf = (id: string | number) => ids.indexOf(String(id)) + 1
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}, position ${posOf(active.id)} of ${ids.length}.`,
    onDragOver: ({ active, over }) => (over ? `${nameOf(active.id)} moved to position ${posOf(over.id)} of ${ids.length}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `${nameOf(active.id)} dropped at position ${posOf(over.id)} of ${ids.length}.` : undefined),
    onDragCancel: () => 'Moving cancelled.',
  }

  // Guests, and any filtered view (the visible order is not the arrangement), get
  // the plain grid: no controls, no DndContext at all.
  if (!canArrange) {
    return <div className={PROJECT_GRID_CLASS}>{sorted.map((p) => <ProjectCard key={p.id} project={p} timezone={timezone} today={today} />)}</div>
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}
      accessibility={{ screenReaderInstructions, announcements }}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className={PROJECT_GRID_CLASS}>
          {sorted.map((p, i) => (
            <SortableProjectCard key={p.id} project={p} index={i} ids={ids} timezone={timezone} today={today} commit={commit} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function SortableProjectCard({ project, index, ids, timezone, today, commit }: {
  project: ProjectDto; index: number; ids: string[]; timezone: string; today: string; commit: Commit
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.id })
  // Null target = a no-op at this position (already first / already last) → the item
  // renders disabled. One-from-last, `later` and `end` are equal and both enabled by
  // design — do not dedupe them.
  const t = moveTargets(ids, index)
  const item = (label: string, target: MoveTarget | null) => ({
    label, disabled: !target, onSelect: () => { if (target) void commit(project.id, target) },
  })
  return (
    // No JS reduced-motion gate: client components still server-render, so a
    // window.matchMedia read here would crash the SSR pass. globals.css §5 already
    // forces transition-duration: 0.01ms !important on * under prefers-reduced-motion,
    // which overrides this inline transition.
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? 'opacity-60' : ''}>
      <ProjectCard project={project} timezone={timezone} today={today} controls={
        <div className="flex items-center gap-0.5">
          {/* p-1.5 around a 14px icon ≈ 26px pointer target (≥24 required). */}
          <button {...attributes} {...listeners} aria-label={`Reorder ${project.name}`} className="-ml-1 rounded-md p-1.5 cursor-grab text-subtle hover:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
            <GripVertical size={14} aria-hidden />
          </button>
          {/* Pointer-free fallback for the same four moves. */}
          <Menu label={`Move ${project.name}`} align="left" button={<ArrowUpDown size={14} aria-hidden />} items={[
            item('Move to front', t.front),
            item('Move earlier', t.earlier),
            item('Move later', t.later),
            item('Move to end', t.end),
          ]} />
        </div>
      } />
    </div>
  )
}
