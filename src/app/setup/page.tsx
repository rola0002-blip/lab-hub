import { redirect } from 'next/navigation'
import { getOrg } from '@/lib/org'
import SetupForm from './setup-form'

export default async function SetupPage() {
  const org = await getOrg()
  if (org?.setupComplete) redirect('/sign-in')
  return (
    <main className="mx-auto max-w-lg p-8">
      <p className="text-sm font-medium text-subtle">01 — Welcome</p>
      <h1 className="mt-1 text-2xl font-semibold text-default">Set up your organisation</h1>
      <SetupForm />
    </main>
  )
}
