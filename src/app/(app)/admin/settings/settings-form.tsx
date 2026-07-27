'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateOrgAction } from './actions'

const TIMEZONES = ['Asia/Singapore', 'UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney']

export default function SettingsForm({ initial }: { initial: { name: string; accentColor: string; timezone: string; updatePromptDay: number; updatePromptHour: number } }) {
  const router = useRouter()
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const input = 'w-full rounded-md border border-border bg-surface px-3 py-2'
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
      <label className="block text-sm">Accent colour<input name="accentColor" type="color" defaultValue={initial.accentColor} className="h-10 w-20 rounded-md border border-border" /></label>
      <label className="block text-sm">Timezone<select name="timezone" defaultValue={initial.timezone} className={input}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</select></label>
      <label className="block text-sm">Weekly update prompt — day
        <select name="updatePromptDay" defaultValue={String(initial.updatePromptDay)} className={input}>
          {/* Monday-first for a lab week; values match Date.getDay() (0=Sunday) */}
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <option key={d} value={d}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]}</option>
          ))}
        </select>
      </label>
      <label className="block text-sm">Weekly update prompt — hour
        <select name="updatePromptHour" defaultValue={String(initial.updatePromptHour)} className={input}>
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
        </select>
      </label>
      <label className="block text-sm">Replace logo<input name="logo" type="file" accept="image/png,image/jpeg,image/webp" className={input} /></label>
      {msg && <p className="text-sm text-muted">{msg}</p>}
      <button disabled={pending} className="rounded-md bg-accent px-4 py-2 font-medium text-accent-on transition-colors hover:bg-accent-hover disabled:opacity-50">Save</button>
    </form>
  )
}
