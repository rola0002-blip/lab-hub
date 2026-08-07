'use client'
import { useState, useTransition } from 'react'
import { inviteAction, revokeInviteAction, resendInviteAction, setRoleAction, deactivateAction, reactivateAction } from './actions'
import { LocalTime } from '@/components/local-time'
import { toast } from '@/components/ui/toast'

type U = { id: string; name: string; email: string; role: string; banned: boolean; title: string | null; timezone: string | null }
type I = { id: string; email: string; role: string; url: string }

// The row's text actions were bare links-as-buttons: ~20px tall (no padding), and only
// Copy link carried a focus ring. One shared class gives all five the ≥24px target
// (20px line + py-1.5) and the same :focus-visible treatment; the colour is per-button.
const ACTION_BTN = 'rounded px-1 py-1.5 whitespace-nowrap hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'

export default function PeopleClient({ users, invitations, isAdmin, selfId }: { users: U[]; invitations: I[]; isAdmin: boolean; selfId: string }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [lastUrl, setLastUrl] = useState<string | null>(null)
  // navigator.clipboard is a SECURE-CONTEXT API — it is `undefined` on the plain-HTTP LAN
  // beta (the same non-secure context that dorms the service worker, spec §5.2), so the write
  // below throws there and we fall back to the toast. The accept URL is therefore ALSO rendered
  // as a selectable readonly <input> next to every Copy button (onFocus selects all), so the
  // admin can always select + copy it manually; clipboard copy is progressive enhancement.
  async function copyLink(url: string) {
    try { await navigator.clipboard.writeText(url); toast('Invite link copied') }
    catch { toast('Copy failed — select and copy the link manually') }
  }

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
              setLastUrl(r.ok ? (r.url ?? null) : null)
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
          {lastUrl && (
            <span className="flex w-full items-center gap-2">
              <input readOnly value={lastUrl} aria-label="Invite link"
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-xs text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
              <button type="button" onClick={() => copyLink(lastUrl)} aria-label="Copy invite link"
                className={ACTION_BTN + ' text-sm text-[var(--text-accent)]'}>
                Copy link
              </button>
            </span>
          )}
        </form>
      )}

      {isAdmin && invitations.length > 0 && (
        <section>
          <h2 className="font-medium text-default">Pending invitations</h2>
          <p className="mt-1 text-xs text-muted">Copy a link to share it directly (works without email). Resending an invite makes a new link and invalidates the old one.</p>
          <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
            {invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-y-2 p-3 text-sm text-default transition-colors hover:bg-hover">
                <span className="min-w-0 truncate">{i.email} · {i.role}</span>
                {/* `basis-full sm:basis-0` is the wrap, not `flex-1`: `flex-1` is
                    `flex: 1 1 0%`, so the actions block's hypothetical main size is ZERO
                    and it can never be the item that wraps — it just squeezes the URL
                    field to nothing beside the email. A 100% basis below sm drops the
                    whole URL+actions block onto its own line; at sm+ basis returns to 0
                    and the historical one-line row is byte-identical. */}
                <span className="flex min-w-0 flex-1 basis-full flex-wrap items-center justify-end gap-2 sm:basis-0">
                  <input readOnly value={i.url} aria-label="Invite link"
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-xs text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
                  <button type="button" onClick={() => copyLink(i.url)} aria-label="Copy invite link" className={ACTION_BTN + ' text-[var(--text-accent)]'}>Copy link</button>
                  <button type="button" onClick={() => start(() => resendInviteAction(i.id))} className={ACTION_BTN + ' text-[var(--text-accent)]'}>Resend</button>
                  <button type="button" onClick={() => start(() => revokeInviteAction(i.id))} className={ACTION_BTN + ' text-[var(--text-danger)]'}>Revoke</button>
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
            <li key={u.id} className={`flex flex-wrap items-center justify-between gap-y-2 p-3 text-sm text-default transition-colors hover:bg-hover ${u.banned ? 'opacity-50' : ''}`}>
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
                    ? <button type="button" onClick={() => start(() => reactivateAction(u.id))} className={ACTION_BTN + ' text-[var(--text-accent)]'}>Reactivate</button>
                    : <button type="button" onClick={() => { if (confirm(`Deactivate ${u.name}? Their sessions end and future bookings are cancelled.`)) start(() => deactivateAction(u.id)) }} className={ACTION_BTN + ' text-[var(--text-danger)]'}>Deactivate</button>}
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
