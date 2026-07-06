import { requireAdmin } from '@/lib/session'
import { getOrg } from '@/lib/org'
import SettingsForm from './settings-form'

export default async function SettingsPage() {
  await requireAdmin()
  const org = await getOrg()
  if (!org) return null
  return (
    <div>
      <p className="text-sm font-medium text-gray-400">04 — Settings</p>
      <h1 className="mt-1 text-2xl font-semibold">Organisation settings</h1>
      <SettingsForm initial={{ name: org.name, accentColor: org.accentColor, timezone: org.timezone }} />
    </div>
  )
}
