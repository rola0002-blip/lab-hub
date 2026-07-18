'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

export default function AcceptForm({ email }: { email: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true); setError(null)
    const fd = new FormData(e.currentTarget)
    const { error } = await authClient.signUp.email({
      email, name: String(fd.get('name')), password: String(fd.get('password')),
    })
    setBusy(false)
    if (error) setError(error.message ?? 'Could not create account')
    else router.push('/issues/me') // first-login landing = personal task list (v0.9.5)
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-surface p-8 shadow-sm">
      <h1 className="text-xl font-semibold text-default">Create your account</h1>
      <p className="text-sm text-muted">Signing up as <strong className="text-default">{email}</strong></p>
      <input name="name" required placeholder="Your name" className="w-full rounded-md border border-border bg-surface px-3 py-2" />
      <input name="password" type="password" required minLength={10} placeholder="Password (min 10 chars)" className="w-full rounded-md border border-border bg-surface px-3 py-2" />
      {error && <p className="text-sm text-[var(--text-danger)]">{error}</p>}
      <button disabled={busy} className="w-full rounded-md bg-accent px-3 py-2 font-medium text-accent-on transition-colors hover:bg-accent-hover disabled:opacity-50">{busy ? 'Creating…' : 'Create account'}</button>
    </form>
  )
}
