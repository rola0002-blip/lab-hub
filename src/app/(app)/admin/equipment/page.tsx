import Link from 'next/link'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/session'
import RetireButton from './retire-button'

export default async function EquipmentAdminPage() {
  await requireAdmin()
  const equipment = await prisma.equipment.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { bookings: { where: { status: { in: ['PENDING', 'CONFIRMED'] }, startsAt: { gt: new Date() } } } } } } })
  return (
    <div>
      <p className="text-sm font-medium text-subtle">03 — Equipment</p>
      <div className="mt-1 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-default">Equipment</h1>
        <Link href="/admin/equipment/new" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on transition-colors hover:bg-accent-hover">Add equipment</Link>
      </div>
      <ul className="mt-6 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
        {equipment.map((e) => (
          <li key={e.id} className={`flex items-center justify-between p-3 text-sm text-default transition-colors hover:bg-hover ${e.status === 'RETIRED' ? 'opacity-50' : ''}`}>
            <span>{e.name} <span className="text-muted">· {e.location}</span>{e.status === 'RETIRED' && ' · retired'}</span>
            <span className="flex items-center gap-3">
              <Link href={`/admin/equipment/${e.id}`} className="text-[var(--text-accent)] hover:underline">Edit</Link>
              {e.status === 'ACTIVE' && <RetireButton id={e.id} name={e.name} futureCount={e._count.bookings} />}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
