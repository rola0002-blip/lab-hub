import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeChannel, makeMember, makeMessage } from '../factories'
import { subscribe, _resetForTests, type LabEvent } from '@/lib/events'
import {
  createChannel, getOrCreateDm, addMembers, removeMember, joinPublicChannel,
  archiveChannel, renameChannel, setChannelTopic, isMember, canManage,
  accessibleConversationIds, listConversations, listPublicChannels,
} from '@/features/chat/conversation-service'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
function collector() {
  const events: LabEvent[] = []
  return { events, send: (e: LabEvent) => events.push(e) }
}

describe('conversation service', () => {
  beforeEach(resetDb)
  afterEach(() => _resetForTests())

  it('members create channels with auto-membership; guests cannot create or join', async () => {
    const member = await makeUser()
    const guest = await makeUser({ role: 'guest' })
    const r = await createChannel({ name: 'general', isPrivate: false, createdById: member.id })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(await isMember(member.id, r.conversationId)).toBe(true)
    expect((await createChannel({ name: 'x', isPrivate: false, createdById: guest.id })).ok).toBe(false)
    expect((await joinPublicChannel({ conversationId: r.conversationId, userId: guest.id })).ok).toBe(false)
  })

  it('members join public channels but not private ones; duplicate names refused', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const pub = await createChannel({ name: 'open', isPrivate: false, createdById: a.id })
    const priv = await createChannel({ name: 'secret', isPrivate: true, createdById: a.id })
    if (!pub.ok || !priv.ok) throw new Error('setup')
    expect((await joinPublicChannel({ conversationId: pub.conversationId, userId: b.id })).ok).toBe(true)
    expect((await joinPublicChannel({ conversationId: priv.conversationId, userId: b.id })).ok).toBe(false)
    expect((await createChannel({ name: 'OPEN', isPrivate: false, createdById: b.id })).ok).toBe(false)
  })

  it('guests must be explicitly added; membership drives accessibility and public listing excludes guests', async () => {
    const admin = await makeUser({ role: 'admin' })
    const guest = await makeUser({ role: 'guest' })
    const ch = await createChannel({ name: 'fyp', isPrivate: false, createdById: admin.id })
    if (!ch.ok) throw new Error('setup')
    expect(await accessibleConversationIds(guest.id)).toEqual([])
    expect(await listPublicChannels(guest.id)).toEqual([])
    const add = await addMembers({ conversationId: ch.conversationId, userIds: [guest.id], byId: admin.id })
    expect(add.ok).toBe(true)
    expect(await accessibleConversationIds(guest.id)).toEqual([ch.conversationId])
  })

  it('only admins or the creator manage membership/archive; self-leave allowed', async () => {
    const creator = await makeUser()
    const rando = await makeUser()
    const joiner = await makeUser()
    const ch = await createChannel({ name: 'lab', isPrivate: false, createdById: creator.id })
    if (!ch.ok) throw new Error('setup')
    await joinPublicChannel({ conversationId: ch.conversationId, userId: joiner.id })
    expect(await canManage(rando.id, ch.conversationId)).toBe(false)
    expect((await addMembers({ conversationId: ch.conversationId, userIds: [rando.id], byId: rando.id })).ok).toBe(false)
    expect((await removeMember({ conversationId: ch.conversationId, userId: joiner.id, byId: rando.id })).ok).toBe(false)
    expect((await removeMember({ conversationId: ch.conversationId, userId: joiner.id, byId: joiner.id })).ok).toBe(true) // self-leave
    expect((await archiveChannel({ conversationId: ch.conversationId, byId: rando.id })).ok).toBe(false)
    expect((await archiveChannel({ conversationId: ch.conversationId, byId: creator.id })).ok).toBe(true)
  })

  it('rename and set-topic are manage-gated, length- and uniqueness-checked', async () => {
    const creator = await makeUser()
    const rando = await makeUser()
    const a = await createChannel({ name: 'alpha', isPrivate: false, createdById: creator.id })
    const b = await createChannel({ name: 'beta', isPrivate: false, createdById: creator.id })
    if (!a.ok || !b.ok) throw new Error('setup')

    // non-managers are refused (forbidden)
    expect(await renameChannel({ conversationId: a.conversationId, name: 'x', byId: rando.id }))
      .toMatchObject({ ok: false, error: 'forbidden' })
    expect(await setChannelTopic({ conversationId: a.conversationId, topic: 'x', byId: rando.id }))
      .toMatchObject({ ok: false, error: 'forbidden' })

    // length bounds + case-insensitive clash with a sibling channel (invalid)
    expect(await renameChannel({ conversationId: a.conversationId, name: '', byId: creator.id })).toMatchObject({ ok: false, error: 'invalid' })
    expect(await renameChannel({ conversationId: a.conversationId, name: 'z'.repeat(61), byId: creator.id })).toMatchObject({ ok: false, error: 'invalid' })
    expect(await renameChannel({ conversationId: a.conversationId, name: 'BETA', byId: creator.id })).toMatchObject({ ok: false, error: 'invalid' })

    // happy path: rename + topic persist (topic trimmed)
    expect((await renameChannel({ conversationId: a.conversationId, name: 'alpha-2', byId: creator.id })).ok).toBe(true)
    expect((await setChannelTopic({ conversationId: a.conversationId, topic: '  Growth runs  ', byId: creator.id })).ok).toBe(true)
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: a.conversationId } })
    expect(row.name).toBe('alpha-2')
    expect(row.topic).toBe('Growth runs')

    // renaming to its own current name is allowed (self excluded from the clash check)
    expect((await renameChannel({ conversationId: a.conversationId, name: 'alpha-2', byId: creator.id })).ok).toBe(true)
  })

  it('a banned channel creator cannot manage', async () => {
    const creator = await makeUser()
    const ch = await createChannel({ name: 'banme', isPrivate: false, createdById: creator.id })
    if (!ch.ok) throw new Error('setup')
    await prisma.user.update({ where: { id: creator.id }, data: { banned: true } })
    expect(await canManage(creator.id, ch.conversationId)).toBe(false)
    expect((await archiveChannel({ conversationId: ch.conversationId, byId: creator.id })).ok).toBe(false)
  })

  it('DMs dedupe by member set, enforce 2..8 active users, and guests may DM anyone', async () => {
    const guest = await makeUser({ role: 'guest' })
    const member = await makeUser()
    const banned = await makeUser({ banned: true })
    const d1 = await getOrCreateDm({ userIds: [guest.id, member.id], byId: guest.id })
    const d2 = await getOrCreateDm({ userIds: [member.id, guest.id], byId: member.id })
    expect(d1.ok && d2.ok && d1.ok === d2.ok && (d1 as { conversationId: string }).conversationId === (d2 as { conversationId: string }).conversationId).toBe(true)
    expect((await getOrCreateDm({ userIds: [guest.id], byId: guest.id })).ok).toBe(false)
    expect((await getOrCreateDm({ userIds: [guest.id, banned.id], byId: guest.id })).ok).toBe(false)
    const nine = [guest.id, member.id, ...(await Promise.all(Array.from({ length: 7 }, () => makeUser()))).map((u) => u.id)]
    expect((await getOrCreateDm({ userIds: nine, byId: guest.id })).ok).toBe(false) // 9 > 8
  })

  it('createChannel emits a live member event for the creator', async () => {
    const creator = await makeUser()
    const c = collector()
    subscribe({ userId: creator.id, conversationIds: new Set(), reload: async () => new Set(), send: c.send })
    await wait(300) // listener connects
    const ch = await createChannel({ name: 'live', isPrivate: false, createdById: creator.id })
    await wait(300)
    expect(ch.ok).toBe(true)
    if (!ch.ok) return
    expect(c.events).toContainEqual({ t: 'member', cid: ch.conversationId, uid: creator.id })
  })

  it('getOrCreateDm emits member to a participant on CREATE, but not on the dedupe-return', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const c = collector() // participant a's live subscription
    subscribe({ userId: a.id, conversationIds: new Set(), reload: async () => new Set(), send: c.send })
    await wait(300)
    const d1 = await getOrCreateDm({ userIds: [a.id, b.id], byId: a.id }) // CREATE
    await wait(300)
    expect(d1.ok).toBe(true)
    if (!d1.ok) return
    expect(c.events).toContainEqual({ t: 'member', cid: d1.conversationId, uid: a.id })
    const memberCountAfterCreate = c.events.filter((e) => e.t === 'member').length
    const d2 = await getOrCreateDm({ userIds: [b.id, a.id], byId: b.id }) // dedupe-return, no emit
    await wait(300)
    expect(d2.ok && (d2 as { conversationId: string }).conversationId === d1.conversationId).toBe(true)
    expect(c.events.filter((e) => e.t === 'member').length).toBe(memberCountAfterCreate)
  })

  it('listConversations returns unread and mention counts from lastReadAt', async () => {
    const me = await makeUser()
    const other = await makeUser()
    const ch = await makeChannel()
    await makeMember(ch.id, me.id, { lastReadAt: new Date(Date.now() - 60_000) })
    await makeMember(ch.id, other.id)
    await makeMessage(ch.id, other.id, { body: 'plain' })
    await makeMessage(ch.id, other.id, { body: `hi <@${me.id}>`, mentionUserIds: [me.id] })
    await makeMessage(ch.id, me.id, { body: 'my own — not unread' })
    const list = await listConversations(me.id)
    expect(list).toHaveLength(1)
    expect(list[0].unread).toBe(2)
    expect(list[0].mentions).toBe(1)
    const pubs = await listPublicChannels(me.id)
    expect(pubs.find((p) => p.id === ch.id)?.isMember).toBe(true)
  })
})
