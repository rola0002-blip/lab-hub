import { requireUser } from '@/lib/session'

export default async function DashboardPage() {
  const user = await requireUser()
  return (
    <div>
      <p className="text-sm font-medium text-gray-400">01 — Dashboard</p>
      <h1 className="mt-1 text-2xl font-semibold">Welcome, {user.name}</h1>
      <p className="mt-4 text-gray-600">Your bookings will appear here.</p>
    </div>
  )
}
