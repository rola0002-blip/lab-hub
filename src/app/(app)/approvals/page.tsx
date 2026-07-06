import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { requireSetup } from '@/lib/org'
import { formatRange } from '@/lib/time'
import ApprovalsClient from './approvals-client'

export default async function ApprovalsPage() {
  const me = await requireUser()
  if (me.role === 'guest') redirect('/dashboard')
  const org = await requireSetup()

  const managedIds = me.role === 'admin'
    ? undefined
    : (await prisma.equipmentManager.findMany({ where: { userId: me.id }, select: { equipmentId: true } })).map((m) => m.equipmentId)
  if (managedIds && managedIds.length === 0) {
    return <p className="text-gray-600">You don&apos;t manage any instruments, so there is nothing to approve.</p>
  }

  const pending = await prisma.booking.findMany({
    where: { status: 'PENDING', ...(managedIds ? { equipmentId: { in: managedIds } } : {}) },
    include: { user: { select: { id: true, name: true, role: true } }, equipment: { select: { id: true, name: true } } },
    orderBy: { startsAt: 'asc' },
  })
  const certs = await prisma.certification.findMany({
    where: { OR: pending.map((p) => ({ userId: p.userId, equipmentId: p.equipmentId })) },
  })

  const items = pending.map((p) => ({
    id: p.id, recurrenceRuleId: p.recurrenceRuleId,
    requester: p.user.name, requesterRole: p.user.role,
    certified: certs.some((c) => c.userId === p.userId && c.equipmentId === p.equipmentId),
    equipmentName: p.equipment.name, purpose: p.purpose,
    when: formatRange(p.startsAt, p.endsAt, org.timezone),
  }))

  const singles = items.filter((i) => !i.recurrenceRuleId)
  const ruleGroups = new Map<string, typeof items>()
  for (const i of items) {
    if (i.recurrenceRuleId) {
      ruleGroups.set(i.recurrenceRuleId, [...(ruleGroups.get(i.recurrenceRuleId) ?? []), i])
    }
  }
  const recurringItems = [...ruleGroups.entries()].map(([ruleId, occ]) => ({
    ruleId, count: occ.length, first: occ[0],
  }))

  return (
    <div>
      <p className="text-sm font-medium text-gray-400">02 — Approvals</p>
      <h1 className="mt-1 text-2xl font-semibold">Approvals queue</h1>
      <ApprovalsClient items={singles} recurring={recurringItems} />
    </div>
  )
}
