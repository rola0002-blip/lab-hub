import Link from 'next/link'
import Image from 'next/image'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { statusChip } from '@/features/booking/chip'

const TONE = {
  green: 'bg-green-100 text-green-800', amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-800', gray: 'bg-gray-200 text-gray-600',
}

export default async function CataloguePage() {
  const me = await requireUser()
  const [equipment, certs] = await Promise.all([
    prisma.equipment.findMany({ orderBy: [{ status: 'asc' }, { name: 'asc' }] }),
    prisma.certification.findMany({ where: { userId: me.id }, select: { equipmentId: true } }),
  ])
  const certSet = new Set(certs.map((c) => c.equipmentId))

  return (
    <div>
      <p className="text-sm font-medium text-gray-400">02 — Booking</p>
      <div className="mt-1 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Equipment</h1>
        <Link href="/booking/day" className="rounded-md border border-gray-300 px-3 py-1.5 text-sm">Lab day view →</Link>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {equipment.map((eq) => {
          const chip = statusChip({ role: me.role, isCertified: certSet.has(eq.id), equipment: eq })
          return (
            <Link key={eq.id} href={`/booking/${eq.id}`}
              className={`rounded-xl border border-gray-200 p-4 transition hover:shadow-md ${eq.status === 'RETIRED' ? 'opacity-50' : ''}`}>
              {eq.photoPath
                ? <Image src={eq.photoPath} alt={eq.name} width={400} height={200} unoptimized className="h-32 w-full rounded-lg object-cover" />
                : <div className="flex h-32 w-full items-center justify-center rounded-lg bg-gray-100 text-3xl">🔬</div>}
              <div className="mt-3 flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-medium">{eq.name}</h2>
                  {eq.location && <p className="text-sm text-gray-500">{eq.location}</p>}
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${TONE[chip.tone]}`}>{chip.label}</span>
              </div>
            </Link>
          )
        })}
      </div>
      {equipment.length === 0 && <p className="mt-6 text-gray-600">No equipment yet. An admin can add instruments under Equipment.</p>}
    </div>
  )
}
