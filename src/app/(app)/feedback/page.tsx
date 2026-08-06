import { requireUser } from '@/lib/session'
import { getOrg } from '@/lib/org'
import { canReviewFeedback } from '@/features/feedback/feedback-policy'
import { listMyFeedback, listAllFeedback } from '@/features/feedback/feedback-service'
import { FeedbackClient } from './feedback-client'

// One role-adaptive route (spec §9.2), the /people conditional-data pattern: the
// review queue is fetched ONLY for an admin, so a member's or guest's RSC payload
// never carries another user's feedback — role gating in the client alone would ship
// the rows to the browser regardless.
export default async function FeedbackPage() {
  const me = await requireUser()
  const org = await getOrg()
  const tz = org?.timezone ?? 'Asia/Singapore'
  const mayReview = canReviewFeedback(me.role)
  const [mine, all] = await Promise.all([
    listMyFeedback(me),
    mayReview ? listAllFeedback(me) : Promise.resolve(undefined),
  ])
  return (
    <div>
      <p className="text-sm font-medium text-subtle">Workspace</p>
      <h1 className="mt-1 text-2xl font-semibold text-default">Feedback</h1>
      <FeedbackClient user={{ id: me.id, role: me.role }} mine={mine} all={all} tz={tz} />
    </div>
  )
}
