'use client'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { authClient } from '@/lib/auth-client'

function ResetForm() {
  const router = useRouter()
  const token = useSearchParams().get('token') ?? ''
  const [error, setError] = useState<string | null>(null)
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const { error } = await authClient.resetPassword({ newPassword: String(fd.get('password')), token })
    if (error) setError(error.message ?? 'Reset failed')
    else router.push('/sign-in')
  }
  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <input name="password" type="password" required minLength={10} placeholder="New password (min 10 chars)" className="w-full rounded-md border border-gray-300 px-3 py-2" />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="w-full rounded-md bg-accent px-3 py-2 font-medium text-white">Set password</button>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  )
}
