import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeChannel, makeMember } from '../factories'
import { resetRate } from '@/features/chat/rate-limit'
import { _resetForTests } from '@/lib/events'

const mockUser = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: string } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => mockUser.current,
  requireUser: async () => mockUser.current,
  requireAdmin: async () => mockUser.current,
}))

import { POST as sendRoute } from '@/app/api/chat/messages/route'
import { GET as listRoute } from '@/app/api/chat/conversations/[id]/messages/route'
import { POST as membersRoute } from '@/app/api/chat/conversations/[id]/members/route'
import { PATCH as editConvoRoute } from '@/app/api/chat/conversations/[id]/route'
import { POST as attachRoute } from '@/app/api/chat/attachments/route'

const jreq = (url: string, body: unknown) =>
  new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

describe('chat API', () => {
  beforeEach(async () => { await resetDb(); resetRate(); mockUser.current = null })
  afterEach(() => _resetForTests())

  it('send: 401 signed out, 403 non-member, 201 member, 422 empty', async () => {
    const ch = await makeChannel()
    const m = await makeUser()
    expect((await sendRoute(jreq('http://t/api/chat/messages', { conversationId: ch.id, body: 'x' }))).status).toBe(401)
    mockUser.current = { ...m, role: m.role }
    expect((await sendRoute(jreq('http://t/api/chat/messages', { conversationId: ch.id, body: 'x' }))).status).toBe(403)
    await makeMember(ch.id, m.id)
    const ok = await sendRoute(jreq('http://t/api/chat/messages', { conversationId: ch.id, body: 'hello' }))
    expect(ok.status).toBe(201)
    expect((await ok.json()).message.body).toBe('hello')
    expect((await sendRoute(jreq('http://t/api/chat/messages', { conversationId: ch.id, body: '   ' }))).status).toBe(422)
  })

  it('list messages is member-gated (403) and returns pages for members', async () => {
    const ch = await makeChannel()
    const m = await makeUser()
    mockUser.current = { ...m, role: m.role }
    const params = Promise.resolve({ id: ch.id })
    expect((await listRoute(new Request('http://t'), { params })).status).toBe(403)
    await makeMember(ch.id, m.id)
    const r = await listRoute(new Request('http://t'), { params })
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ messages: [], hasMore: false })
  })

  it('members add is manage-gated and notifies channel_added', async () => {
    const creator = await makeUser()
    const guest = await makeUser({ role: 'guest' })
    const ch = await makeChannel({ createdById: creator.id })
    await makeMember(ch.id, creator.id)
    const params = Promise.resolve({ id: ch.id })
    mockUser.current = { ...guest, role: 'guest' }
    expect((await membersRoute(jreq('http://t', { userIds: [guest.id] }), { params })).status).toBe(403)
    mockUser.current = { ...creator, role: creator.role }
    expect((await membersRoute(jreq('http://t', { userIds: [guest.id] }), { params })).status).toBe(200)
    expect(await prisma.notification.count({ where: { userId: guest.id, type: 'channel_added' } })).toBe(1)
  })

  it('conversation PATCH renames/sets topic, manage-gated (401 / 403 / 200)', async () => {
    const creator = await makeUser()
    const rando = await makeUser()
    const ch = await makeChannel({ createdById: creator.id })
    await makeMember(ch.id, creator.id)
    const params = Promise.resolve({ id: ch.id })
    const patch = (body: unknown) =>
      new Request('http://t', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

    expect((await editConvoRoute(patch({ name: 'x' }), { params })).status).toBe(401) // signed out
    mockUser.current = { ...rando, role: rando.role }
    expect((await editConvoRoute(patch({ name: 'x' }), { params })).status).toBe(403) // non-manager
    mockUser.current = { ...creator, role: creator.role }
    expect((await editConvoRoute(patch({ name: 'renamed', topic: 'new topic' }), { params })).status).toBe(200)
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: ch.id } })
    expect(row.name).toBe('renamed')
    expect(row.topic).toBe('new topic')
  })

  it('attachments: valid pdf stored, executable rejected 422', async () => {
    const m = await makeUser()
    mockUser.current = { ...m, role: m.role }
    const form = new FormData()
    form.set('file', new File([new Uint8Array(100)], 'paper.pdf', { type: 'application/pdf' }))
    const ok = await attachRoute(new Request('http://t', { method: 'POST', body: form }))
    expect(ok.status).toBe(201)
    expect((await ok.json()).path).toMatch(/^\/uploads\/chat\//)
    const bad = new FormData()
    bad.set('file', new File([new Uint8Array(10)], 'evil.exe', { type: 'application/x-msdownload' }))
    expect((await attachRoute(new Request('http://t', { method: 'POST', body: bad }))).status).toBe(422)
  })
})
