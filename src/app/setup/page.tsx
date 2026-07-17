import { redirect } from 'next/navigation'
import { getOrg } from '@/lib/org'
import { setupTokenConfigured } from '@/lib/setup-token'
import SetupForm from './setup-form'

export default async function SetupPage() {
  const org = await getOrg()
  if (org?.setupComplete) redirect('/sign-in')
  // Only surface the token field when a SETUP_TOKEN gate is configured (SP7 F1); otherwise the
  // wizard is unchanged (dev/local + existing deployments show no extra field).
  const tokenRequired = setupTokenConfigured()
  return (
    <main className="mx-auto max-w-lg p-8">
      <p className="text-sm font-medium text-subtle">01 — Welcome</p>
      <h1 className="mt-1 text-2xl font-semibold text-default">Set up your organisation</h1>
      <SetupForm tokenRequired={tokenRequired} />
    </main>
  )
}
