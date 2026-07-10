import Link from 'next/link'
import Image from 'next/image'
import { Microscope } from 'lucide-react'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { statusChip, CHIP_VARIANT } from '@/features/booking/chip'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'

export default async function CataloguePage() {
  const me = await requireUser()
  const [equipment, certs] = await Promise.all([
    prisma.equipment.findMany({ orderBy: [{ status: 'asc' }, { name: 'asc' }] }),
    prisma.certification.findMany({ where: { userId: me.id }, select: { equipmentId: true } }),
  ])
  const certSet = new Set(certs.map((c) => c.equipmentId))

  return (
    <div>
      <p className="text-sm font-medium text-subtle">02 — Booking</p>
      <div className="mt-1 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-default">Equipment</h1>
        <Link href="/booking/day" className="rounded-md border border-border px-3 py-1.5 text-sm text-default transition-colors hover:bg-hover">Lab day view →</Link>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {equipment.map((eq) => {
          const chip = statusChip({ role: me.role, isCertified: certSet.has(eq.id), equipment: eq })
          return (
            <Link key={eq.id} href={`/booking/${eq.id}`}
              className={`rounded-xl border border-border bg-surface p-4 shadow-xs transition-colors hover:border-border-strong ${eq.status === 'RETIRED' ? 'opacity-50' : ''}`}>
              {eq.photoPath
                ? <Image src={eq.photoPath} alt={eq.name} width={400} height={200} unoptimized className="h-32 w-full rounded-lg object-cover" />
                : <div className="flex h-32 w-full items-center justify-center rounded-lg bg-surface-sunken text-3xl">🔬</div>}
              <div className="mt-3 flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-medium text-default">{eq.name}</h2>
                  {eq.location && <p className="text-sm text-muted">{eq.location}</p>}
                </div>
                <span className="shrink-0"><Badge variant={CHIP_VARIANT[chip.tone]}>{chip.label}</Badge></span>
              </div>
            </Link>
          )
        })}
      </div>
      {equipment.length === 0 && (
        <EmptyState icon={Microscope} title="No instruments yet"
          hint="An admin can add instruments under Equipment, and they will appear here to book." />
      )}
    </div>
  )
}
