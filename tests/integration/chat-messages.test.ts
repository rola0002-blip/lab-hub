import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeChannel, makeDm, makeMember, makeMessage } from '../factories'
import { resetRate } from '@/features/chat/rate-limit'
import { _resetForTests } from '@/lib/events'
import { saveUpload, readUpload } from '@/lib/uploads'
import {
  sendMessage, editMessage, deleteMessage, toggleReaction, listMessages, listThread, markRead,
} from '@/features/chat/message-service'
import { listConversations } from '@/features/chat/conversation-service'

describe('message service', () => {
  beforeEach(async () => { await resetDb(); resetRate() })
  afterEach(() => _resetForTests())

  async function channelWith(...roles: string[]) {
    const users = await Promise.all(roles.map((role) => makeUser({ role })))
    const ch = await makeChannel()
    await Promise.all(users.map((u) => makeMember(ch.id, u.id)))
    return { ch, users }
  }

  it('members send; non-members are forbidden; archived channels reject', async () => {
    const { ch, users: [a] } = await channelWith('member')
    const outsider = await makeUser()
    const ok = await sendMessage({ userId: a.id, conversationId: ch.id, body: 'hello' })
    expect(ok.ok).toBe(true)
    const no = await sendMessage({ userId: outsider.id, conversationId: ch.id, body: 'hi' })
    expect(no).toMatchObject({ ok: false, error: 'forbidden' })
    await prisma.conversation.update({ where: { id: ch.id }, data: { archivedAt: new Date() } })
    expect((await sendMessage({ userId: a.id, conversationId: ch.id, body: 'x' })).ok).toBe(false)
  })

  it('stores member-scoped mentions; guest @channel is inert; sender never self-mentions', async () => {
    const { ch, users: [m, g] } = await channelWith('member', 'guest')
    const outsider = await makeUser()
    const r1 = await sendMessage({ userId: m.id, conversationId: ch.id, body: `<@${g.id}> <@${outsider.id}> <@${m.id}> <!channel>` })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    expect(r1.message.mentionUserIds).toEqual([g.id]) // outsider + self filtered
    expect(r1.message.mentionsChannel).toBe(true)
    const r2 = await sendMessage({ userId: g.id, conversationId: ch.id, body: 'oi <!channel>' })
    if (!r2.ok) return
    expect(r2.message.mentionsChannel).toBe(false) // guests cannot @channel
  })

  it('threads are single-level: replies attach to roots only, and reply counts show up', async () => {
    const { ch, users: [a, b] } = await channelWith('member', 'member')
    const root = await sendMessage({ userId: a.id, conversationId: ch.id, body: 'root' })
    if (!root.ok) return
    const reply = await sendMessage({ userId: b.id, conversationId: ch.id, body: 'reply', parentId: root.message.id })
    expect(reply.ok).toBe(true)
    if (!reply.ok) return
    const nested = await sendMessage({ userId: a.id, conversationId: ch.id, body: 'nested?', parentId: reply.message.id })
    expect(nested).toMatchObject({ ok: false, error: 'invalid' })
    const thread = await listThread({ userId: a.id, rootId: root.message.id })
    expect(thread.ok && thread.replies.map((r) => r.body)).toEqual(['reply'])
    const list = await listMessages({ userId: a.id, conversationId: ch.id })
    expect(list.ok && list.messages.find((m) => m.id === root.message.id)?.replyCount).toBe(1)
    expect(list.ok && list.messages.some((m) => m.id === reply.message.id)).toBe(false) // replies not in root list
  })

  it('listThread denies non-members and rejects a reply used as a root', async () => {
    const { ch, users: [a] } = await channelWith('member')
    const outsider = await makeUser()
    const root = await sendMessage({ userId: a.id, conversationId: ch.id, body: 'root' })
    expect(root.ok).toBe(true)
    if (!root.ok) return
    const reply = await sendMessage({ userId: a.id, conversationId: ch.id, body: 'reply', parentId: root.message.id })
    expect(reply.ok).toBe(true)
    if (!reply.ok) return

    expect((await listThread({ userId: outsider.id, rootId: root.message.id })).ok).toBe(false) // membership gate
    expect((await listThread({ userId: a.id, rootId: reply.message.id })).ok).toBe(false) // a reply is not a valid root
    const ok = await listThread({ userId: a.id, rootId: root.message.id })
    expect(ok.ok && ok.replies.map((r) => r.body)).toEqual(['reply']) // member gets the thread
  })

  it('edit is author-only and re-parses mentions; delete is author-or-admin soft delete', async () => {
    const { ch, users: [a, b, admin] } = await channelWith('member', 'member', 'admin')
    const r = await sendMessage({ userId: a.id, conversationId: ch.id, body: 'v1' })
    if (!r.ok) return
    expect((await editMessage({ messageId: r.message.id, userId: b.id, body: 'nope' })).ok).toBe(false)
    expect((await editMessage({ messageId: r.message.id, userId: a.id, body: `v2 <@${b.id}>` })).ok).toBe(true)
    const edited = await prisma.message.findUniqueOrThrow({ where: { id: r.message.id } })
    expect(edited.editedAt).not.toBeNull()
    expect(edited.mentionUserIds).toEqual([b.id])
    expect((await deleteMessage({ messageId: r.message.id, userId: b.id })).ok).toBe(false)
    expect((await deleteMessage({ messageId: r.message.id, userId: admin.id })).ok).toBe(true)
    const gone = await prisma.message.findUniqueOrThrow({ where: { id: r.message.id } })
    expect(gone.deletedAt).not.toBeNull()
    expect(gone.body).toBe('')
    expect((await editMessage({ messageId: r.message.id, userId: a.id, body: 'zombie' })).ok).toBe(false)
  })

  it('deleting a message removes its attachment rows and unlinks the files', async () => {
    const { ch, users: [a] } = await channelWith('member')
    const uploadPath = await saveUpload(new File([new Uint8Array(32)], 'data.pdf', { type: 'application/pdf' }), 'chat')
    const rel = uploadPath.replace('/uploads/', '').split('/')
    const sent = await sendMessage({
      userId: a.id, conversationId: ch.id, body: 'here',
      attachments: [{ path: uploadPath, name: 'data.pdf', mime: 'application/pdf', size: 32 }],
    })
    expect(sent.ok).toBe(true)
    if (!sent.ok) return
    expect(await readUpload(rel)).not.toBeNull() // file on disk
    expect(await prisma.chatAttachment.count({ where: { messageId: sent.message.id } })).toBe(1)

    expect((await deleteMessage({ messageId: sent.message.id, userId: a.id })).ok).toBe(true)
    expect(await prisma.chatAttachment.count({ where: { messageId: sent.message.id } })).toBe(0) // rows gone
    expect(await readUpload(rel)).toBeNull() // file unlinked
    const tombstone = await prisma.message.findUniqueOrThrow({ where: { id: sent.message.id } })
    expect(tombstone.deletedAt).not.toBeNull() // message row survives as a tombstone
  })

  it('reactions toggle per (user,emoji) and require membership', async () => {
    const { ch, users: [a, b] } = await channelWith('member', 'member')
    const outsider = await makeUser()
    const r = await sendMessage({ userId: a.id, conversationId: ch.id, body: 'react to me' })
    if (!r.ok) return
    expect((await toggleReaction({ messageId: r.message.id, userId: b.id, emoji: '👍' })).ok).toBe(true)
    expect((await toggleReaction({ messageId: r.message.id, userId: outsider.id, emoji: '👍' })).ok).toBe(false)
    expect(await prisma.reaction.count({ where: { messageId: r.message.id } })).toBe(1)
    await toggleReaction({ messageId: r.message.id, userId: b.id, emoji: '👍' }) // toggle off
    expect(await prisma.reaction.count({ where: { messageId: r.message.id } })).toBe(0)
  })

  it('rate limit blocks the 31st send with rate_limited', async () => {
    const { ch, users: [a] } = await channelWith('member')
    for (let i = 0; i < 30; i++) {
      const r = await sendMessage({ userId: a.id, conversationId: ch.id, body: `m${i}` })
      expect(r.ok).toBe(true)
    }
    expect(await sendMessage({ userId: a.id, conversationId: ch.id, body: 'no' })).toMatchObject({ ok: false, error: 'rate_limited' })
  })

  it('pagination pages backwards by cursor; markRead zeroes unread', async () => {
    const me = await makeUser()
    const other = await makeUser()
    const dm = await makeDm([me.id, other.id])
    for (let i = 0; i < 60; i++) await makeMessage(dm.id, other.id, { body: `m${i}`, createdAt: new Date(Date.now() - (60 - i) * 1000) })
    const page1 = await listMessages({ userId: me.id, conversationId: dm.id })
    if (!page1.ok) return
    expect(page1.messages).toHaveLength(50)
    expect(page1.hasMore).toBe(true)
    expect(page1.messages[49].body).toBe('m59') // oldest-first within page, newest page first
    const page2 = await listMessages({ userId: me.id, conversationId: dm.id, before: page1.messages[0].id })
    expect(page2.ok && page2.messages).toHaveLength(10)
    expect(page2.ok && page2.hasMore).toBe(false)
    await markRead({ userId: me.id, conversationId: dm.id })
    const list = await listConversations(me.id)
    expect(list[0].unread).toBe(0)
  })
})
