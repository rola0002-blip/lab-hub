import { Suspense } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Microscope } from 'lucide-react'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { statusChip, CHIP_VARIANT } from '@/features/booking/chip'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'

export default function CataloguePage() {
  return (
    <div>
      <p className="text-sm font-medium text-subtle">02 — Booking</p>
      <div className="mt-1 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-default">Equipment</h1>
        <Link href="/booking/day" className="rounded-md border border-border px-3 py-1.5 text-sm text-default transition-colors hover:bg-hover">Lab day view →</Link>
      </div>
      {/* The catalogue's DB read streams behind a skeleton grid — the header above
          renders instantly. Scoped as an in-page Suspense (not a route loading.tsx)
          so the /booking/[equipmentId] calendar route keeps its synchronous render. */}
      <Suspense fallback={<CatalogueSkeleton />}>
        <EquipmentGrid />
      </Suspense>
    </div>
  )
}

async function EquipmentGrid() {
  const me = await requireUser()
  const [equipment, certs] = await Promise.all([
    prisma.equipment.findMany({ orderBy: [{ status: 'asc' }, { name: 'asc' }] }),
    prisma.certification.findMany({ where: { userId: me.id }, select: { equipmentId: true } }),
  ])
  const certSet = new Set(certs.map((c) => c.equipmentId))

  if (equipment.length === 0) {
    return (
      <EmptyState icon={Microscope} title="No instruments yet"
        hint="An admin can add instruments under Equipment, and they will appear here to book." />
    )
  }

  return (
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
  )
}

// Skeleton grid mirroring the instrument cards (photo block + two text lines).
function CatalogueSkeleton() {
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-surface p-4 shadow-xs">
          <div className="h-32 w-full rounded-lg bg-active motion-safe:animate-pulse" />
          <div className="mt-3"><Skeleton lines={2} /></div>
        </div>
      ))}
    </div>
  )
}
