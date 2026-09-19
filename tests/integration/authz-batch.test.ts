import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeChannel, makeMember, makeMessage, makeEquipment } from '../factories'
import { _resetForTests } from '@/lib/events'
import { editMessage, deleteMessage } from '@/features/chat/message-service'
import { grantCertification } from '@/features/certifications/service'
import { PolicyError } from '@/features/certifications/policy'

// Task 10 authz batch: the four direct authorization fixes. Chat authorization is
// ConversationMember — a REMOVED member must lose edit/delete on the messages they
// authored while they were in the conversation (the toggleReaction posture).
describe('removed members lose edit/delete on old messages', () => {
  beforeEach(async () => { await resetDb() })
  afterEach(() => _resetForTests())

  it('editMessage and deleteMessage reject non-members', async () => {
    const u = await makeUser()
    const convo = await makeChannel()
    await makeMember(convo.id, u.id)
    const msg = await makeMessage(convo.id, u.id, { body: 'hi' })
    await prisma.conversationMember.delete({ where: { conversationId_userId: { conversationId: convo.id, userId: u.id } } })
    expect((await editMessage({ messageId: msg.id, userId: u.id, body: 'x' })).ok).toBe(false)
    expect((await deleteMessage({ messageId: msg.id, userId: u.id })).ok).toBe(false)
    expect(await prisma.message.findUniqueOrThrow({ where: { id: msg.id } })).toMatchObject({ deletedAt: null, body: 'hi' })
  })

  it('a current member still edits and deletes their own message', async () => {
    const u = await makeUser()
    const convo = await makeChannel()
    await makeMember(convo.id, u.id)
    const msg = await makeMessage(convo.id, u.id, { body: 'hi' })
    expect((await editMessage({ messageId: msg.id, userId: u.id, body: 'edited' })).ok).toBe(true)
    expect((await deleteMessage({ messageId: msg.id, userId: u.id })).ok).toBe(true)
  })
})

// Trainee validation: the trainer set was already validated (real, non-banned,
// non-system, non-guest); the TRAINEE must now be a real, non-banned, non-system
// user too. Guests remain certifiable — pinned behavior.
describe('certification trainee validation', () => {
  beforeEach(async () => {
    await resetDb()
    // grantCertification reads the org timezone (orgToday future-date rule), but
    // resetDb TRUNCATEs Organization and no factory recreates it.
    await prisma.organization.create({ data: { name: 'Lab', timezone: 'Asia/Singapore' } })
  })

  it('rejects certifying a banned or system trainee', async () => {
    const manager = await makeUser({ role: 'admin' })
    const banned = await makeUser({ banned: true })
    const bot = await prisma.user.create({
      // User.id has no DB default (factories mint a UUID) — same here.
      data: { id: randomUUID(), name: 'Bot', email: 'bot@authz-batch.test', emailVerified: true, isSystem: true },
    })
    const eq = await makeEquipment()
    await expect(grantCertification({ userId: banned.id, equipmentId: eq.id, grantedById: manager.id, trainedOn: '2026-01-01' }))
      .rejects.toBeInstanceOf(PolicyError)
    await expect(grantCertification({ userId: bot.id, equipmentId: eq.id, grantedById: manager.id, trainedOn: '2026-01-01' }))
      .rejects.toBeInstanceOf(PolicyError)
    expect(await prisma.certification.count()).toBe(0)
    expect(await prisma.trainingRecord.count()).toBe(0)
  })

  it('guests remain certifiable (pinned behavior)', async () => {
    const manager = await makeUser({ role: 'admin' })
    const guest = await makeUser({ role: 'guest' })
    const eq = await makeEquipment()
    await grantCertification({ userId: guest.id, equipmentId: eq.id, grantedById: manager.id, trainedOn: '2026-01-01' })
    expect(await prisma.certification.count({ where: { userId: guest.id } })).toBe(1)
  })
})
