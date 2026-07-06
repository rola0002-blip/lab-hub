'use client'
import { useState } from 'react'
import { authClient } from '@/lib/auth-client'

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    await authClient.requestPasswordReset({ email: String(fd.get('email')), redirectTo: '/reset-password' })
    setSent(true) // always claim success; do not reveal which emails exist
  }
  if (sent) return <p className="text-gray-700">If that email has an account, a reset link is on its way.</p>
  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
      <h1 className="text-xl font-semibold">Reset password</h1>
      <input name="email" type="email" required placeholder="Email" className="w-full rounded-md border border-gray-300 px-3 py-2" />
      <button className="w-full rounded-md bg-accent px-3 py-2 font-medium text-white">Send reset link</button>
    </form>
  )
}
