import { redirect } from 'next/navigation'
import { getOrg } from '@/lib/org'
import { getSessionUser } from '@/lib/session'
import { landingHrefFor } from '@/lib/landing'

export default async function Home() {
  const org = await getOrg()
  if (!org?.setupComplete) redirect('/setup')
  // Setup gate precedes auth: an org-less install must land on /setup whatever
  // the session state. Post-login landing (F7) is decided by landingHrefFor.
  redirect(await landingHrefFor((await getSessionUser())?.id ?? null))
}
