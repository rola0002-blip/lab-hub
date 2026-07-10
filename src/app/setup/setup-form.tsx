'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { completeSetup } from './actions'

const TIMEZONES = ['Asia/Singapore', 'UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney']

export default function SetupForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true); setError(null)
    const fd = new FormData(e.currentTarget)
    const logo = fd.get('logo') as File | null
    const r = await completeSetup({
      orgName: String(fd.get('orgName')), accentColor: String(fd.get('accentColor')),
      timezone: String(fd.get('timezone')), adminName: String(fd.get('adminName')),
      adminEmail: String(fd.get('adminEmail')), adminPassword: String(fd.get('adminPassword')),
      logo: logo && logo.size > 0 ? logo : null,
    })
    setBusy(false)
    if (!r.ok) setError(r.message)
    else router.push('/sign-in')
  }

  const input = 'w-full rounded-md border border-gray-300 px-3 py-2'
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <label className="block text-sm">Organisation name<input name="orgName" required defaultValue="COLOSSUS" className={input} /></label>
      <label className="block text-sm">Accent colour<input name="accentColor" type="color" defaultValue="#0d9488" className="h-10 w-20 rounded-md border border-gray-300" /></label>
      <label className="block text-sm">Timezone<select name="timezone" defaultValue="Asia/Singapore" className={input}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</select></label>
      <label className="block text-sm">Logo (optional, PNG/JPEG/WebP ≤ 2 MB)<input name="logo" type="file" accept="image/png,image/jpeg,image/webp" className={input} /></label>
      <hr className="my-2" />
      <p className="text-sm font-medium text-gray-400">02 — Administrator account</p>
      <label className="block text-sm">Your name<input name="adminName" required className={input} /></label>
      <label className="block text-sm">Email<input name="adminEmail" type="email" required className={input} /></label>
      <label className="block text-sm">Password (min 10 chars)<input name="adminPassword" type="password" minLength={10} required className={input} /></label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={busy} className="rounded-md bg-accent px-4 py-2 font-medium text-white disabled:opacity-50">{busy ? 'Setting up…' : 'Finish setup'}</button>
    </form>
  )
}
