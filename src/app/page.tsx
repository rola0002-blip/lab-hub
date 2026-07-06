import { redirect } from 'next/navigation'
import { getOrg } from '@/lib/org'

export default async function Home() {
  const org = await getOrg()
  redirect(org?.setupComplete ? '/dashboard' : '/setup')
}
