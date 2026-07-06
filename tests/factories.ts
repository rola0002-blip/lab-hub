import { prisma } from '@/lib/db'
import { randomUUID } from 'node:crypto'

export async function resetDb() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "Notification","EmailOutbox","Booking","RecurrenceRule",
      "MaintenanceWindow","Certification","EquipmentManager","Equipment",
      "Invitation","Organization","session","account","verification","user" CASCADE
  `)
}

export async function makeUser(over: { role?: string; name?: string; banned?: boolean } = {}) {
  const id = randomUUID()
  return prisma.user.create({
    data: {
      id,
      name: over.name ?? `User ${id.slice(0, 6)}`,
      email: `${id.slice(0, 12)}@test.local`,
      emailVerified: true,
      role: over.role ?? 'member',
      banned: over.banned ?? false,
    },
  })
}

export async function makeEquipment(over: Record<string, unknown> = {}) {
  return prisma.equipment.create({
    data: {
      name: `Instr ${randomUUID().slice(0, 6)}`,
      description: 'test instrument',
      location: 'Lab 1',
      ...over,
    },
  })
}

export function hoursFromNow(h: number) {
  return new Date(Date.now() + h * 3_600_000)
}
