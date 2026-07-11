'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { authClient } from '@/lib/auth-client'

export default function SignInPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const fd = new FormData(e.currentTarget)
    const { error } = await authClient.signIn.email({
      email: String(fd.get('email')),
      password: String(fd.get('password')),
    })
    setBusy(false)
    if (error) setError(error.message ?? 'Sign-in failed')
    else router.push('/dashboard')
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-surface p-8 shadow-sm">
      <h1 className="text-xl font-semibold text-default">Sign in</h1>
      <input name="email" type="email" required placeholder="Email" aria-label="Email" className="w-full rounded-md border border-border bg-surface px-3 py-2" />
      <input name="password" type="password" required placeholder="Password" aria-label="Password" className="w-full rounded-md border border-border bg-surface px-3 py-2" />
      {error && <p className="text-sm text-[var(--text-danger)]">{error}</p>}
      <button disabled={busy} className="w-full rounded-md bg-accent px-3 py-2 font-medium text-accent-on transition-colors hover:bg-accent-hover disabled:opacity-50">
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <Link href="/forgot-password" className="block text-sm text-muted hover:underline">
        Forgot password?
      </Link>
    </form>
  )
}
