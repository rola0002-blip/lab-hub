import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeChannel, makeMember, makeMessage } from '../factories'
import { _resetForTests } from '@/lib/events'
import {
  createChannel, getOrCreateDm, addMembers, removeMember, joinPublicChannel,
  archiveChannel, isMember, canManage, accessibleConversationIds, listConversations, listPublicChannels,
} from '@/features/chat/conversation-service'

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
