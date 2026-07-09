import { prisma } from '@/lib/db'
import { randomUUID } from 'node:crypto'

export async function resetDb() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "Conversation","ConversationMember","Message","Reaction",
      "ChatAttachment","PushSubscription",
      "Notification","EmailOutbox","Booking","RecurrenceRule",
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

export async function makeChannel(over: Record<string, unknown> = {}) {
  return prisma.conversation.create({
    data: { type: 'CHANNEL', name: `chan-${randomUUID().slice(0, 6)}`, createdById: 'seed', ...over },
  })
}

export async function makeDm(userIds: string[]) {
  const dmKey = [...userIds].sort().join('|')
  const convo = await prisma.conversation.create({ data: { type: 'DM', createdById: userIds[0], dmKey } })
  await prisma.conversationMember.createMany({ data: userIds.map((userId) => ({ conversationId: convo.id, userId })) })
  return convo
}

export async function makeMember(conversationId: string, userId: string, over: Record<string, unknown> = {}) {
  return prisma.conversationMember.create({ data: { conversationId, userId, ...over } })
}

export async function makeMessage(conversationId: string, userId: string, over: Record<string, unknown> = {}) {
  return prisma.message.create({ data: { conversationId, userId, body: `msg ${randomUUID().slice(0, 6)}`, ...over } })
}
