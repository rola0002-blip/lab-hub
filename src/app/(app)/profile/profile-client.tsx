'use client'
import { useRef, useState } from 'react'
import { Camera, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { ThemeToggle } from '@/components/theme-toggle'
import { AccentPicker } from '@/components/accent-picker'
import { SoundsToggle } from '@/components/sounds-toggle'
import { toast } from '@/lib/toast-store'

type ProfileUser = {
  id: string; name: string; email: string; image: string | null
  title: string; timezone: string; role: string
}

// Full IANA list from the runtime ICU — the same set the server validates against.
const TIMEZONES = Intl.supportedValuesOf('timeZone')

export default function ProfileClient({ user, soundsEnabled }: { user: ProfileUser; soundsEnabled: boolean }) {
  const [image, setImage] = useState<string | null>(user.image)
  const [name, setName] = useState(user.name)
  const [title, setTitle] = useState(user.title)
  const [timezone, setTimezone] = useState(user.timezone)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function onSave() {
    const n = name.trim()
    if (n.length < 1 || n.length > 80) { toast('Name must be 1–80 characters.'); return }
    if (title.trim().length > 100) { toast('Title must be 100 characters or fewer.'); return }
    setBusy(true)
    const res = await fetch('/api/me', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: n, title, timezone }),
    }).catch(() => null)
    setBusy(false)
    toast(res && res.ok ? 'Profile saved.' : 'Could not save your profile.')
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { toast('Photo must be 5 MB or smaller.'); return }
    setBusy(true)
    const fd = new FormData(); fd.append('file', file)
    const res = await fetch('/api/me/avatar', { method: 'POST', body: fd }).catch(() => null)
    setBusy(false)
    if (res && res.ok) {
      const d = await res.json().catch(() => null)
      setImage(d?.image ?? null)
      toast('Photo updated.')
    } else {
      toast('Could not upload that photo. Use a PNG, JPG, or WebP up to 5 MB.')
    }
  }

  async function onRemovePhoto() {
    setBusy(true)
    const res = await fetch('/api/me/avatar', { method: 'DELETE' }).catch(() => null)
    setBusy(false)
    if (res && res.ok) { setImage(null); toast('Photo removed.') }
    else toast('Could not remove your photo.')
  }

  return (
    <div className="mt-6 space-y-8">
      <section className="rounded-xl border border-border bg-surface p-4 shadow-xs">
        <h2 className="text-sm font-semibold text-default">Photo</h2>
        <div className="mt-3 flex items-center gap-4">
          <Avatar name={name || 'You'} id={user.id} image={image} size={48} />
          <div className="flex gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-default hover:bg-hover disabled:opacity-50">
              <Camera size={15} aria-hidden /> Upload photo
            </button>
            {image && (
              <button type="button" onClick={onRemovePhoto} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-[var(--text-danger)] hover:bg-hover disabled:opacity-50">
                <Trash2 size={15} aria-hidden /> Remove
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload profile photo" className="sr-only" onChange={onPickFile} />
        </div>
        <p className="mt-2 text-xs text-muted">PNG, JPG, or WebP up to 5 MB.</p>
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 shadow-xs">
        <h2 className="text-sm font-semibold text-default">About you</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-default">Full name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2" />
          </label>
          <label className="text-sm text-default">Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="e.g. PhD candidate"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2" />
          </label>
          <label className="text-sm text-default sm:col-span-2">Timezone
            <div className="mt-1 flex gap-2">
              <select value={timezone} onChange={(e) => setTimezone(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2">
                <option value="">Not set</option>
                {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
              <button type="button" onClick={() => setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone)}
                className="shrink-0 rounded-md border border-border px-3 py-2 text-sm text-default hover:bg-hover">
                Set automatically
              </button>
            </div>
          </label>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="text-sm"><span className="text-muted">Email</span><p className="text-default">{user.email}</p></div>
          <div className="text-sm"><span className="text-muted">Workspace role</span><p className="capitalize text-default">{user.role}</p></div>
        </div>
        <button type="button" onClick={onSave} disabled={busy}
          className="mt-4 rounded-md bg-accent px-4 py-2 font-medium text-accent-on hover:bg-accent-hover disabled:opacity-50">
          Save changes
        </button>
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 shadow-xs">
        <h2 className="text-sm font-semibold text-default">Appearance</h2>
        <div className="mt-3 flex items-center justify-between gap-4">
          <p className="text-sm text-muted">Theme — light or dark. Your choice follows you across devices.</p>
          <ThemeToggle />
        </div>
        <div className="mt-4">
          <p className="text-sm text-muted">Accent color — used for buttons, links, and highlights. The sidebar rail stays teal-slate.</p>
          <div className="mt-2"><AccentPicker /></div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-4">
          <p className="text-sm text-muted">Notification sounds — a soft chime for mentions and direct messages on this device.</p>
          <SoundsToggle initial={soundsEnabled} />
        </div>
      </section>
    </div>
  )
}
