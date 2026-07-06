'use client'
import { useState, useTransition } from 'react'
import { inviteAction, revokeInviteAction, resendInviteAction, setRoleAction, deactivateAction, reactivateAction } from './actions'

type U = { id: string; name: string; email: string; role: string; banned: boolean }
type I = { id: string; email: string; role: string }

export default function PeopleClient({ users, invitations, isAdmin, selfId }: { users: U[]; invitations: I[]; isAdmin: boolean; selfId: string }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  return (
    <div className="mt-6 space-y-8">
      {isAdmin && (
        <form className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 p-4"
          onSubmit={(e) => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            start(async () => {
              const r = await inviteAction(String(fd.get('email')), String(fd.get('role')))
              setMsg(r.ok ? 'Invitation sent.' : (r.message ?? 'Failed'))
            })
          }}>
          <label className="text-sm">Email<br /><input name="email" type="email" required className="rounded-md border border-gray-300 px-3 py-2" /></label>
          <label className="text-sm">Role<br />
            <select name="role" defaultValue="guest" className="rounded-md border border-gray-300 px-3 py-2">
              <option value="guest">Guest</option><option value="member">Member</option><option value="admin">Admin</option>
            </select>
          </label>
          <button disabled={pending} className="rounded-md bg-accent px-4 py-2 font-medium text-white disabled:opacity-50">Invite</button>
          {msg && <span className="text-sm text-gray-600">{msg}</span>}
        </form>
      )}

      {isAdmin && invitations.length > 0 && (
        <section>
          <h2 className="font-medium">Pending invitations</h2>
          <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200">
            {invitations.map((i) => (
              <li key={i.id} className="flex items-center justify-between p-3 text-sm">
                <span>{i.email} · {i.role}</span>
                <span className="flex gap-2">
                  <button onClick={() => start(() => resendInviteAction(i.id))} className="text-accent hover:underline">Resend</button>
                  <button onClick={() => start(() => revokeInviteAction(i.id))} className="text-red-600 hover:underline">Revoke</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="font-medium">Members</h2>
        <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200">
          {users.map((u) => (
            <li key={u.id} className={`flex items-center justify-between p-3 text-sm ${u.banned ? 'opacity-50' : ''}`}>
              <span>{u.name} <span className="text-gray-500">· {u.email}</span>{u.banned && ' · deactivated'}</span>
              {isAdmin && u.id !== selfId ? (
                <span className="flex items-center gap-2">
                  <select defaultValue={u.role} onChange={(e) => start(() => setRoleAction(u.id, e.target.value))} className="rounded-md border border-gray-300 px-2 py-1">
                    <option value="guest">Guest</option><option value="member">Member</option><option value="admin">Admin</option>
                  </select>
                  {u.banned
                    ? <button onClick={() => start(() => reactivateAction(u.id))} className="text-accent hover:underline">Reactivate</button>
                    : <button onClick={() => { if (confirm(`Deactivate ${u.name}? Their sessions end and future bookings are cancelled.`)) start(() => deactivateAction(u.id)) }} className="text-red-600 hover:underline">Deactivate</button>}
                </span>
              ) : (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs uppercase tracking-wide text-gray-600">{u.role}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
