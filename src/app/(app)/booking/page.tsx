import { Suspense } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Microscope } from 'lucide-react'
import type { Prisma as P } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { statusChip, partitionCatalogue, CHIP_VARIANT, type Chip } from '@/features/booking/chip'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'

// Local to this page — the /projects grid's spacing differs, so PROJECT_GRID_CLASS
// is deliberately NOT reused here.
const GRID_CLASS = 'mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3'
const HEADING_CLASS = 'text-sm font-semibold text-muted'

// Named managers are what turn "Ask an equipment manager" into an actionable
// instruction (spec §4.3); the catalogue reads them for the certification band.
const CATALOGUE_INCLUDE = { managers: { include: { user: { select: { id: true, name: true, image: true } } } } } as const
type CatalogueItem = P.EquipmentGetPayload<{ include: typeof CATALOGUE_INCLUDE }>

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
    prisma.equipment.findMany({ include: CATALOGUE_INCLUDE, orderBy: [{ status: 'asc' }, { name: 'asc' }] }),
    prisma.certification.findMany({ where: { userId: me.id }, select: { equipmentId: true } }),
  ])
  const certSet = new Set(certs.map((c) => c.equipmentId))
  // One projection, shared by the split and by each card's chip, so a card can never
  // disagree with the section it was filed under.
  const chipArgs = (eq: CatalogueItem) => ({ role: me.role, isCertified: certSet.has(eq.id), equipment: eq })

  // The whole-lab empty state stays keyed to the FULL list: an empty SECTION simply
  // does not render, but a lab with no instruments still gets the onboarding hint.
  if (equipment.length === 0) {
    return (
      <EmptyState icon={Microscope} title="No instruments yet"
        hint="An admin can add instruments under Equipment, and they will appear here to book." />
    )
  }

  const sections = partitionCatalogue(equipment, chipArgs)
  const card = (eq: CatalogueItem) => <EquipmentCard key={eq.id} eq={eq} chip={statusChip(chipArgs(eq))} />

  return (
    <div className="mt-6 space-y-8">
      {sections.available.length > 0 && (
        <section>
          <h2 className={HEADING_CLASS}>Available to you</h2>
          <div className={GRID_CLASS}>{sections.available.map(card)}</div>
        </section>
      )}
      {sections.certification.length > 0 && (
        <section>
          <h2 className={HEADING_CLASS}>Needs certification</h2>
          {/* The policy block's own words (booking/policy.ts:37), now with the people
              to ask named on the cards below. */}
          <p className="mt-1 text-sm text-muted">Ask an equipment manager to certify you.</p>
          <div className={GRID_CLASS}>
            {sections.certification.map((eq) => (
              <EquipmentCard key={eq.id} eq={eq} chip={statusChip(chipArgs(eq))} managers={eq.managers} />
            ))}
          </div>
        </section>
      )}
      {sections.retired.length > 0 && (
        <section>
          <h2 className={HEADING_CLASS}>Retired</h2>
          <div className={GRID_CLASS}>{sections.retired.map(card)}</div>
        </section>
      )}
    </div>
  )
}

function EquipmentCard({ eq, chip, managers }: { eq: CatalogueItem; chip: Chip; managers?: CatalogueItem['managers'] }) {
  return (
    <Link href={`/booking/${eq.id}`}
      className={`rounded-xl border border-border bg-surface p-4 shadow-xs transition-colors hover:border-border-strong ${eq.status === 'RETIRED' ? 'opacity-50' : ''}`}>
      {eq.photoPath
        ? <Image src={eq.photoPath} alt={eq.name} width={400} height={200} unoptimized className="h-32 w-full rounded-lg object-cover" />
        : <div className="flex h-32 w-full items-center justify-center rounded-lg bg-surface-sunken text-3xl">🔬</div>}
      <div className="mt-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-medium text-default">{eq.name}</h3>
          {eq.location && <p className="text-sm text-muted">{eq.location}</p>}
        </div>
        <span className="shrink-0"><Badge variant={CHIP_VARIANT[chip.tone]}>{chip.label}</Badge></span>
      </div>
      {/* Nothing at all when the instrument has no managers — no fabricated contact. */}
      {managers && managers.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {managers.map((m) => (
            <span key={m.id} className="flex items-center gap-1.5">
              <Avatar size={20} name={m.user.name} id={m.user.id} image={m.user.image} />{m.user.name}
            </span>
          ))}
        </div>
      )}
    </Link>
  )
}

// Skeleton grid mirroring the instrument cards (photo block + two text lines).
function CatalogueSkeleton() {
  return (
    <div className={GRID_CLASS}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-surface p-4 shadow-xs">
          <div className="h-32 w-full rounded-lg bg-active motion-safe:animate-pulse" />
          <div className="mt-3"><Skeleton lines={2} /></div>
        </div>
      ))}
    </div>
  )
}
