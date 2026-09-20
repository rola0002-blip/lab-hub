import { requireUser } from '@/lib/session'
import { getOrg } from '@/lib/org'
import { canReviewRa } from '@/features/ra/ra-policy'
import { raOptions, listMyRaAcknowledgments, listAllRaAcknowledgments } from '@/features/ra/ra-service'
import { PageHeader } from '@/components/page-header'
import { RaClient } from './ra-client'

// Role-adaptive (the /feedback pattern): the records table is fetched ONLY for
// an admin, so a member's/guest's RSC payload never carries another user's
// acknowledgments.
export default async function RaPage() {
  const me = await requireUser()
  const org = await getOrg()
  const tz = org?.timezone ?? 'Asia/Singapore'
  const mayReview = canReviewRa(me.role)
  const [options, mine, all] = await Promise.all([
    raOptions(me),
    listMyRaAcknowledgments(me),
    mayReview ? listAllRaAcknowledgments(me) : Promise.resolve(undefined),
  ])
  return (
    <div>
      <PageHeader eyebrow="Workspace" title="RA acknowledgments" />
      <RaClient name={me.name} options={options} mine={mine} all={all} tz={tz} />
    </div>
  )
}
