import { requireUser } from '@/lib/session'
import { getOrg } from '@/lib/org'
import { canReviewRa } from '@/features/ra/ra-policy'
import { raOptions, listMyRaAcknowledgments, listAllRaAcknowledgments } from '@/features/ra/ra-service'
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
      <p className="text-sm font-medium text-subtle">Workspace</p>
      <h1 className="mt-1 text-2xl font-semibold text-default">RA acknowledgments</h1>
      <RaClient name={me.name} options={options} mine={mine} all={all} tz={tz} />
    </div>
  )
}
