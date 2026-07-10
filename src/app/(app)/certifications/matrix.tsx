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
    <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-surface shadow-xs">
      {msg && <p className="p-2 text-sm text-[var(--color-danger)]">{msg}</p>}
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border-b border-border p-2 text-left font-medium text-default">Person</th>
            {equipment.map((e) => <th key={e.id} className="border-b border-border p-2 text-left font-medium text-default">{e.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="transition-colors hover:bg-hover">
              <td className="border-b border-border p-2 text-default">{u.name} <span className="text-xs text-subtle">{u.role}</span></td>
              {equipment.map((e) => (
                <td key={e.id} className="border-b border-border p-2">
                  <input type="checkbox" checked={has(u.id, e.id)} disabled={pending || !editable.includes(e.id)}
                    onChange={(ev) => start(async () => {
                      const r = await toggleCertAction(u.id, e.id, ev.target.checked)
                      setMsg(r.ok ? null : (r.message ?? 'Failed'))
                    })} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
