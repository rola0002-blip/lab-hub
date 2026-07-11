'use client'
import { useState, useTransition } from 'react'
import { inviteAction, revokeInviteAction, resendInviteAction, setRoleAction, deactivateAction, reactivateAction } from './actions'
import { LocalTime } from '@/components/local-time'

type U = { id: string; name: string; email: string; role: string; banned: boolean; title: string | null; timezone: string | null }
type I = { id: string; email: string; role: string }

export default function PeopleClient({ users, invitations, isAdmin, selfId }: { users: U[]; invitations: I[]; isAdmin: boolean; selfId: string }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  return (
    <div className="mt-6 space-y-8">
      {isAdmin && (
        <form className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-4 shadow-xs"
          onSubmit={(e) => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            start(async () => {
              const r = await inviteAction(String(fd.get('email')), String(fd.get('role')))
              setMsg(r.ok ? 'Invitation sent.' : (r.message ?? 'Failed'))
            })
          }}>
          <label className="text-sm text-default">Email<br /><input name="email" type="email" required className="rounded-md border border-border bg-surface px-3 py-2" /></label>
          <label className="text-sm text-default">Role<br />
            <select name="role" defaultValue="guest" className="rounded-md border border-border bg-surface px-3 py-2">
              <option value="guest">Guest</option><option value="member">Member</option><option value="admin">Admin</option>
            </select>
          </label>
          <button disabled={pending} className="rounded-md bg-accent px-4 py-2 font-medium text-accent-on transition-colors hover:bg-accent-hover disabled:opacity-50">Invite</button>
          {msg && <span className="text-sm text-muted">{msg}</span>}
        </form>
      )}

      {isAdmin && invitations.length > 0 && (
        <section>
          <h2 className="font-medium text-default">Pending invitations</h2>
          <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
            {invitations.map((i) => (
              <li key={i.id} className="flex items-center justify-between p-3 text-sm text-default transition-colors hover:bg-hover">
                <span>{i.email} · {i.role}</span>
                <span className="flex gap-2">
                  <button onClick={() => start(() => resendInviteAction(i.id))} className="text-accent hover:underline">Resend</button>
                  <button onClick={() => start(() => revokeInviteAction(i.id))} className="text-[var(--color-danger)] hover:underline">Revoke</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="font-medium text-default">Members</h2>
        <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
          {users.map((u) => (
            <li key={u.id} className={`flex items-center justify-between p-3 text-sm text-default transition-colors hover:bg-hover ${u.banned ? 'opacity-50' : ''}`}>
              <span className="min-w-0">
                <span className="block truncate">{u.name} <span className="text-muted">· {u.email}</span>{u.banned && ' · deactivated'}</span>
                <span className="flex items-center gap-2">
                  {u.title && <span className="text-xs text-muted">{u.title}</span>}
                  <LocalTime timezone={u.timezone} />
                </span>
              </span>
              {isAdmin && u.id !== selfId ? (
                <span className="flex items-center gap-2">
                  <select defaultValue={u.role} onChange={(e) => start(() => setRoleAction(u.id, e.target.value))} className="rounded-md border border-border bg-surface px-2 py-1">
                    <option value="guest">Guest</option><option value="member">Member</option><option value="admin">Admin</option>
                  </select>
                  {u.banned
                    ? <button onClick={() => start(() => reactivateAction(u.id))} className="text-accent hover:underline">Reactivate</button>
                    : <button onClick={() => { if (confirm(`Deactivate ${u.name}? Their sessions end and future bookings are cancelled.`)) start(() => deactivateAction(u.id)) }} className="text-[var(--color-danger)] hover:underline">Deactivate</button>}
                </span>
              ) : (
                <span className="rounded-full bg-active px-2 py-0.5 text-xs uppercase tracking-wide text-muted">{u.role}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
