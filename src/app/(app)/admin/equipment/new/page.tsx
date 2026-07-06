import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/session'
import EquipmentForm from '../equipment-form'
import { createEquipmentAction } from '../actions'

export default async function NewEquipmentPage() {
  await requireAdmin()
  const users = await prisma.user.findMany({ where: { banned: false, role: { not: 'guest' } }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
  return (
    <div>
      <h1 className="text-2xl font-semibold">Add equipment</h1>
      <EquipmentForm action={createEquipmentAction} users={users} />
    </div>
  )
}
