import { describe, it, expect, beforeEach } from 'vitest'
import { resetDb, makeUser, makeEquipment, seedSystem } from '../factories'
import { prisma } from '@/lib/db'
import { COLOSSUS_BOT_ID } from '@/features/bot/ids'
import { setManagers } from '@/features/equipment/service'
import { grantCertification } from '@/features/certifications/service'

// decide 'grant' funnels through grantCertification, which reads the org timezone
// for the trainedOn future-date rule — resetDb TRUNCATEs Organization and no
// factory recreates it, so give every test an org (the certifications.test.ts
// pattern). seedSystem brings the bot user back so the { suppress: true } DMs
// in the service deliver instead of tripping the bot's non-fatal catch.
async function resetWithOrg() {
  await resetDb()
  await seedSystem()
  await prisma.organization.create({ data: { name: 'Lab', timezone: 'Asia/Singapore' } })
}

// Bot-authored messages in the DM the bot shares with `userId` (bot-triggers idiom).
const botDmCount = (userId: string) =>
  prisma.message.count({ where: { userId: COLOSSUS_BOT_ID, conversation: { type: 'DM', members: { some: { userId } } } } })

// eq has NO managers ⇒ the admin is a fallback decider (W21-A); tests that need a managed instrument call setManagers.
async function seed() {
  const member = await makeUser({ role: 'member' })
  const admin = await makeUser({ role: 'admin' })
  const eq = await makeEquipment({ certificationRequired: true })
  return { member, admin, eq }
}

describe('training requests', () => {
  beforeEach(resetWithOrg)

  it('member requests; duplicate PENDING rejected; grant certifies + notifies', async () => {
    const { member, admin, eq } = await seed()
    const svc = await import('@/features/certifications/training-request-service')
    expect((await svc.createTrainingRequest({ userId: member.id, equipmentId: eq.id, note: 'please' })).ok).toBe(true)
    expect((await svc.createTrainingRequest({ userId: member.id, equipmentId: eq.id })).ok).toBe(false) // one open request
    const rows = await svc.listPendingRequests(admin.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userId: member.id, equipmentId: eq.id, note: 'please' })
    const r = await svc.decideTrainingRequest({ requestId: rows[0].id, byId: admin.id, decision: 'grant', trainedOn: '2026-09-19' })
    expect(r.ok).toBe(true)
    expect(await prisma.certification.findUnique({ where: { userId_equipmentId: { userId: member.id, equipmentId: eq.id } } })).not.toBeNull()
    const req = await prisma.trainingRequest.findFirstOrThrow({ where: { userId: member.id } })
    expect(req.status).toBe('GRANTED')
    expect(req.decidedById).toBe(admin.id)
    expect(await prisma.notification.count({ where: { userId: member.id, type: 'training_decided' } })).toBeGreaterThan(0)
    expect(await prisma.notification.count({ where: { userId: admin.id, type: 'training_request' } })).toBeGreaterThan(0)
  })

  // W20-C review: a bell row pops out + pushes, so the requester (here an admin
  // who is also a manager of the instrument) is not alerted about their own
  // request — while every OTHER decider is. W21-A: on a managed instrument the
  // deciders are its active managers ONLY — a non-manager admin hears nothing.
  it('the requester is never notified of their own request; other managers are; non-manager admins are not', async () => {
    const { admin, eq } = await seed()
    const otherAdmin = await makeUser({ role: 'admin' })
    const mgr = await makeUser({ role: 'member' })
    await setManagers(eq.id, [admin.id, mgr.id])
    const svc = await import('@/features/certifications/training-request-service')
    expect((await svc.createTrainingRequest({ userId: admin.id, equipmentId: eq.id })).ok).toBe(true)
    expect(await prisma.notification.count({ where: { userId: admin.id, type: 'training_request' } })).toBe(0)
    expect(await botDmCount(admin.id)).toBe(0)
    expect(await prisma.notification.count({ where: { userId: mgr.id, type: 'training_request' } })).toBe(1)
    expect(await botDmCount(mgr.id)).toBe(1)
    expect(await prisma.notification.count({ where: { userId: otherAdmin.id, type: 'training_request' } })).toBe(0)
    expect(await botDmCount(otherAdmin.id)).toBe(0)
    // Only the alert is dropped: the request still sits in the requester-manager's queue.
    expect(await svc.listPendingRequests(admin.id)).toHaveLength(1)
    expect(await svc.listPendingRequests(otherAdmin.id)).toHaveLength(0)
  })

  it('W21-A: on a managed instrument only its managers see, count and decide — a non-manager admin cannot', async () => {
    const { member, admin, eq } = await seed()
    const mgr = await makeUser({ role: 'member' })
    await setManagers(eq.id, [mgr.id])
    const svc = await import('@/features/certifications/training-request-service')
    expect((await svc.createTrainingRequest({ userId: member.id, equipmentId: eq.id })).ok).toBe(true)
    expect(await prisma.notification.count({ where: { userId: admin.id, type: 'training_request' } })).toBe(0)
    expect(await prisma.notification.count({ where: { userId: mgr.id, type: 'training_request' } })).toBe(1)
    expect(await svc.listPendingRequests(admin.id)).toHaveLength(0)
    expect(await svc.countPendingRequests({ id: admin.id, role: 'admin' })).toBe(0)
    const [row] = await svc.listPendingRequests(mgr.id)
    expect(await svc.countPendingRequests({ id: mgr.id, role: 'member' })).toBe(1)
    expect(await svc.decideTrainingRequest({ requestId: row.id, byId: admin.id, decision: 'grant' }))
      .toEqual({ ok: false, message: "Only this instrument's managers can decide this request." })
    expect((await prisma.trainingRequest.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PENDING')
    expect((await svc.decideTrainingRequest({ requestId: row.id, byId: mgr.id, decision: 'grant' })).ok).toBe(true)
    const decided = await prisma.trainingRequest.findUniqueOrThrow({ where: { id: row.id } })
    expect(decided).toMatchObject({ status: 'GRANTED', decidedById: mgr.id })
  })

  it('W21-A: no ACTIVE manager (banned / guest rows only) ⇒ the admins are the fallback deciders', async () => {
    const { member, admin, eq } = await seed()
    const banned = await makeUser({ role: 'member', banned: true })
    const guestMgr = await makeUser({ role: 'guest' })
    await setManagers(eq.id, [banned.id, guestMgr.id])
    const svc = await import('@/features/certifications/training-request-service')
    expect((await svc.createTrainingRequest({ userId: member.id, equipmentId: eq.id })).ok).toBe(true)
    expect(await prisma.notification.count({ where: { userId: admin.id, type: 'training_request' } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: guestMgr.id, type: 'training_request' } })).toBe(0)
    expect(await svc.countPendingRequests({ id: admin.id, role: 'admin' })).toBe(1)
    const [row] = await svc.listPendingRequests(admin.id)
    expect((await svc.decideTrainingRequest({ requestId: row.id, byId: guestMgr.id, decision: 'grant' })).ok).toBe(false)
    expect((await svc.decideTrainingRequest({ requestId: row.id, byId: admin.id, decision: 'grant' })).ok).toBe(true)
  })

  it('W21-A: canDecideTrainingRequest truth table', async () => {
    const { admin, eq } = await seed()
    const unmanaged = await makeEquipment({ certificationRequired: true })
    const mgr = await makeUser({ role: 'member' })
    const rando = await makeUser({ role: 'member' })
    const guestMgr = await makeUser({ role: 'guest' })
    await setManagers(eq.id, [mgr.id, guestMgr.id])
    const { canDecideTrainingRequest: can } = await import('@/features/certifications/training-request-service')
    expect(await can(mgr.id, eq.id)).toBe(true)           // active manager
    expect(await can(admin.id, eq.id)).toBe(false)        // admin, instrument has an active manager
    expect(await can(admin.id, unmanaged.id)).toBe(true)  // admin fallback
    expect(await can(rando.id, eq.id)).toBe(false)        // non-manager member
    expect(await can(rando.id, unmanaged.id)).toBe(false) // fallback is admins only
    expect(await can(guestMgr.id, eq.id)).toBe(false)     // a guest manager never decides
    expect(await can('nobody', eq.id)).toBe(false)        // missing user
  })

  it('decline requires a reason; re-request allowed after decline', async () => {
    const { member, admin, eq } = await seed()
    const svc = await import('@/features/certifications/training-request-service')
    await svc.createTrainingRequest({ userId: member.id, equipmentId: eq.id })
    const [row] = await svc.listPendingRequests(admin.id)
    expect((await svc.decideTrainingRequest({ requestId: row.id, byId: admin.id, decision: 'decline' })).ok).toBe(false)
    expect((await svc.decideTrainingRequest({ requestId: row.id, byId: admin.id, decision: 'decline', reason: 'calendar full until October' })).ok).toBe(true)
    const declined = await prisma.trainingRequest.findFirstOrThrow({ where: { userId: member.id } })
    expect(declined.status).toBe('DECLINED')
    expect(declined.rejectionReason).toBe('calendar full until October')
    expect((await svc.createTrainingRequest({ userId: member.id, equipmentId: eq.id })).ok).toBe(true)
  })

  it('guests and already-certified members cannot request', async () => {
    const { member, admin, eq } = await seed()
    const guest = await makeUser({ role: 'guest' })
    await grantCertification({ userId: member.id, equipmentId: eq.id, grantedById: admin.id, trainedOn: '2026-01-01' })
    const svc = await import('@/features/certifications/training-request-service')
    expect((await svc.createTrainingRequest({ userId: guest.id, equipmentId: eq.id })).ok).toBe(false)
    expect((await svc.createTrainingRequest({ userId: member.id, equipmentId: eq.id })).ok).toBe(false)
    expect((await svc.createTrainingRequest({ userId: member.id, equipmentId: (await makeEquipment()).id })).ok).toBe(false) // not cert-gated
  })

  it('non-managers cannot decide; decided requests are no longer pending', async () => {
    const { member, admin, eq } = await seed()
    const rando = await makeUser({ role: 'member' })
    const svc = await import('@/features/certifications/training-request-service')
    await svc.createTrainingRequest({ userId: member.id, equipmentId: eq.id })
    const [row] = await svc.listPendingRequests(admin.id)
    expect((await svc.decideTrainingRequest({ requestId: row.id, byId: rando.id, decision: 'decline', reason: 'nope' })).ok).toBe(false)
    expect((await svc.decideTrainingRequest({ requestId: row.id, byId: admin.id, decision: 'grant' })).ok).toBe(true) // trainedOn defaults to today
    expect((await svc.decideTrainingRequest({ requestId: row.id, byId: admin.id, decision: 'decline', reason: 'x' })).ok).toBe(false) // already decided
    expect((await svc.listPendingRequests(admin.id))).toHaveLength(0)
  })
})
