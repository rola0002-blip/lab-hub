'use client'
import { useTransition, useState } from 'react'
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
  return (
    <div className="mt-6 overflow-x-auto">
      {msg && <p className="mb-2 text-sm text-red-600">{msg}</p>}
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border-b border-gray-200 p-2 text-left">Person</th>
            {equipment.map((e) => <th key={e.id} className="border-b border-gray-200 p-2 text-left">{e.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td className="border-b border-gray-100 p-2">{u.name} <span className="text-xs text-gray-400">{u.role}</span></td>
              {equipment.map((e) => (
                <td key={e.id} className="border-b border-gray-100 p-2">
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
