import 'server-only'
import { countPendingApprovals } from '@/features/booking/service'
import { countPendingRequests } from '@/features/certifications/training-request-service'
import type { NavCounts } from './nav-counts-store'

// W20-D: the sidebar's pending badges (Approvals / Certifications) for one viewer
// — the layout's SSR seed and GET /api/nav-counts share this. Guests decide
// nothing and their rows are hidden, so they short-circuit without a query.
export async function loadNavCounts(user: { id: string; role: string }): Promise<NavCounts> {
  if (user.role === 'guest') return { approvals: 0, trainingRequests: 0 }
  const [approvals, trainingRequests] = await Promise.all([countPendingApprovals(user), countPendingRequests(user)])
  return { approvals, trainingRequests }
}
