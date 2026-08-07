'use client'
import { useTransition, useState } from 'react'
import { Award } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { toggleCertAction } from './actions'

type Props = {
  users: Array<{ id: string; name: string; role: string }>
  equipment: Array<{ id: string; name: string }>
  certs: Array<{ userId: string; equipmentId: string }>
  editable: string[]
}

export default function Matrix({ users, equipment, certs, editable }: Props) {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const has = (u: string, e: string) => certs.some((c) => c.userId === u && c.equipmentId === e)

  if (equipment.length === 0) {
    return <EmptyState icon={Award} title="No instruments to certify"
      hint="Once an admin adds active equipment, grant people access to it here." />
  }

  return (
    // A BOUNDED scroller (both axes): sticky only resolves against a scrollport, so the
    // capped height is what makes the header row real — without it the page scrolls and
    // `top-0` never engages. Safe here because this subtree renders no <Menu>: menu.tsx
    // treats every clipping ancestor as a hard popover bound (files-client.tsx:176-182).
    <div className="mt-6 max-h-[80dvh] overflow-auto rounded-xl border border-border bg-surface shadow-xs">
      {msg && <p className="p-2 text-sm text-[var(--text-danger)]">{msg}</p>}
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 min-w-40 border-b border-border bg-surface p-2 text-left font-medium text-default">Person</th>
            {equipment.map((e) => <th key={e.id} className="sticky top-0 z-20 border-b border-border bg-surface p-2 text-left font-medium text-default">{e.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="group transition-colors hover:bg-hover">
              {/* The frozen name column paints its own background (a sticky cell would
                  otherwise let the scrolled checkboxes show through), so the row hover
                  has to be re-applied here from the row's `group`. */}
              <td className="sticky left-0 z-10 whitespace-nowrap border-b border-border bg-surface p-2 text-default transition-colors group-hover:bg-hover">{u.name} <span className="text-xs text-subtle">{u.role}</span></td>
              {equipment.map((e) => (
                <td key={e.id} className="border-b border-border p-2">
                  {/* The <label> is the ≥24px tap target; the input keeps its own
                      aria-label, so the cell has an accessible name of its own rather
                      than relying on the (visually distant) column header. */}
                  <label className="flex min-h-6 min-w-6 cursor-pointer items-center justify-center p-1">
                    <input type="checkbox" aria-label={`${u.name} — ${e.name}`} checked={has(u.id, e.id)} disabled={pending || !editable.includes(e.id)}
                      onChange={(ev) => start(async () => {
                        const r = await toggleCertAction(u.id, e.id, ev.target.checked)
                        setMsg(r.ok ? null : (r.message ?? 'Failed'))
                      })} />
                  </label>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
