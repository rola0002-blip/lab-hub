import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/session'
import EquipmentForm from '../equipment-form'
import { updateEquipmentAction } from '../actions'

export default async function EditEquipmentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const { id } = await params
  const eq = await prisma.equipment.findUnique({ where: { id }, include: { managers: true } })
  if (!eq) notFound()
  const users = await prisma.user.findMany({ where: { banned: false, role: { not: 'guest' }, isSystem: false }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
  const bound = updateEquipmentAction.bind(null, eq.id)
  return (
    <div>
      <h1 className="text-2xl font-semibold text-default">Edit {eq.name}</h1>
      <EquipmentForm action={bound} users={users}
        initial={{ name: eq.name, description: eq.description, location: eq.location, advanceBookingDays: eq.advanceBookingDays, maxDurationMinutes: eq.maxDurationMinutes, certificationRequired: eq.certificationRequired, approvalPolicy: eq.approvalPolicy, allowRecurring: eq.allowRecurring, managerIds: eq.managers.map((m) => m.userId) }} />
    </div>
  )
}
