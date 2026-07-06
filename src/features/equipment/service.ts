import 'server-only'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { notify } from '@/lib/notify'
import { formatRange } from '@/lib/time'
import type { Equipment } from '@prisma/client'

export const equipmentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).default(''),
  location: z.string().max(200).default(''),
  advanceBookingDays: z.coerce.number().int().min(1).max(365),
  maxDurationMinutes: z.coerce.number().int().min(15).max(1440),
  certificationRequired: z.boolean(),
  approvalPolicy: z.enum(['NONE', 'GUESTS', 'ALL']),
  allowRecurring: z.boolean(),
  photoPath: z.string().nullable().optional(),
})
export type EquipmentPolicyInput = z.infer<typeof equipmentSchema>

export async function createEquipment(data: EquipmentPolicyInput): Promise<Equipment> {
  return prisma.equipment.create({ data: equipmentSchema.parse(data) })
}

export async function updateEquipment(id: string, data: Partial<EquipmentPolicyInput>): Promise<Equipment> {
  return prisma.equipment.update({ where: { id }, data: equipmentSchema.partial().parse(data) })
}

export async function setManagers(equipmentId: string, userIds: string[]): Promise<void> {
  await prisma.$transaction([
    prisma.equipmentManager.deleteMany({ where: { equipmentId } }),
    prisma.equipmentManager.createMany({ data: userIds.map((userId) => ({ userId, equipmentId })) }),
  ])
}

export async function isManagerOf(userId: string, equipmentId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (user?.role === 'admin') return true
  return !!(await prisma.equipmentManager.findUnique({ where: { userId_equipmentId: { userId, equipmentId } } }))
}

export async function retireEquipment(id: string): Promise<{ cancelled: number }> {
  const eq = await prisma.equipment.update({ where: { id }, data: { status: 'RETIRED' } })
  const org = await prisma.organization.findFirst()
  const victims = await prisma.booking.findMany({
    where: { equipmentId: id, status: { in: ['PENDING', 'CONFIRMED'] }, startsAt: { gt: new Date() } },
  })
  await prisma.booking.updateMany({
    where: { id: { in: victims.map((v) => v.id) } },
    data: { status: 'CANCELLED', rejectionReason: 'Equipment retired' },
  })
  for (const b of victims) {
    const when = formatRange(b.startsAt, b.endsAt, org?.timezone ?? 'Asia/Singapore')
    await notify(b.userId, 'booking_cancelled', { message: `${eq.name} was retired; your booking ${when} was cancelled.` }, {
      subject: `[${org?.name ?? 'LabHub'}] Booking cancelled: ${eq.name} retired`,
      html: `<p>Your booking of <strong>${eq.name}</strong> (${when}) was cancelled because the instrument was retired.</p>`,
    })
  }
  return { cancelled: victims.length }
}
