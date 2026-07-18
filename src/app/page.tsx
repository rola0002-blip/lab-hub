import { redirect } from 'next/navigation'
import { getOrg } from '@/lib/org'

export default async function Home() {
  const org = await getOrg()
  // Post-login landing is the personal task list (v0.9.5). /dashboard stays
  // reachable from the nav; this is only the default destination.
  redirect(org?.setupComplete ? '/issues/me' : '/setup')
}
