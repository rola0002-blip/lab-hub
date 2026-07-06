'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateOrgAction } from './actions'

const TIMEZONES = ['Asia/Singapore', 'UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney']

export default function SettingsForm({ initial }: { initial: { name: string; accentColor: string; timezone: string } }) {
  const router = useRouter()
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const input = 'w-full rounded-md border border-gray-300 px-3 py-2'
  return (
    <form className="mt-6 max-w-md space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        start(async () => {
          const r = await updateOrgAction(fd)
          setMsg(r.ok ? 'Saved.' : (r.message ?? 'Failed'))
          if (r.ok) router.refresh()
        })
      }}>
      <label className="block text-sm">Organisation name<input name="name" required defaultValue={initial.name} className={input} /></label>
      <label className="block text-sm">Accent colour<input name="accentColor" type="color" defaultValue={initial.accentColor} className="h-10 w-20 rounded-md border border-gray-300" /></label>
      <label className="block text-sm">Timezone<select name="timezone" defaultValue={initial.timezone} className={input}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</select></label>
      <label className="block text-sm">Replace logo<input name="logo" type="file" accept="image/png,image/jpeg,image/webp" className={input} /></label>
      {msg && <p className="text-sm text-gray-600">{msg}</p>}
      <button disabled={pending} className="rounded-md bg-accent px-4 py-2 font-medium text-white disabled:opacity-50">Save</button>
    </form>
  )
}
