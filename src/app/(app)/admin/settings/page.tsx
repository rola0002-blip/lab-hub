import { requireAdmin } from '@/lib/session'
import { getOrg } from '@/lib/org'
import { ThemeToggle } from '@/components/theme-toggle'
import SettingsForm from './settings-form'
import { APP_VERSION } from '@/lib/version'
import { env } from '@/lib/env'

export default async function SettingsPage() {
  await requireAdmin()
  const org = await getOrg()
  if (!org) return null
  return (
    <div>
      <p className="text-sm font-medium text-subtle">04 — Settings</p>
      <h1 className="mt-1 text-2xl font-semibold text-default">Organisation settings</h1>
      <SettingsForm initial={{ name: org.name, accentColor: org.accentColor, timezone: org.timezone }} />

      <section className="mt-8 max-w-md rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-default">Appearance</h2>
        <div className="mt-3 flex items-center justify-between gap-4">
          <p className="text-sm text-muted">Theme — Light or dark. Your choice follows you across devices.</p>
          <ThemeToggle />
        </div>
      </section>

      <section className="mt-8 max-w-md rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-default">About</h2>
        <p className="mt-3 text-sm text-muted">LabHub v{APP_VERSION}</p>
      </section>

      {!env.SMTP_HOST && (
        <section className="mt-8 max-w-md rounded-lg border border-border p-4">
          <h2 className="text-sm font-semibold text-default">Email delivery</h2>
          <p className="mt-3 text-sm text-muted">Email delivery: disabled — no SMTP configured. Invitations and notifications will not be sent by email; share invite links directly.</p>
        </section>
      )}
    </div>
  )
}
