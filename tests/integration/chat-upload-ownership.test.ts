import path from 'node:path'
import os from 'node:os'
import { rm } from 'node:fs/promises'

// Confine attachment writes to a throwaway dir so the suite leaves the repo tree
// clean (the issue-routes.test.ts idiom). uploadsDir() reads UPLOADS_DIR lazily
// per call, so setting it here (before the route modules import) is enough.
const UPLOAD_DIR = path.join(os.tmpdir(), 'labhub-chat-upload-ownership')
process.env.UPLOADS_DIR = UPLOAD_DIR

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeChannel, makeMember } from '../factories'
import { saveUpload, readUpload } from '@/lib/uploads'
import { recordChatUpload } from '@/features/chat/upload-ownership'
import { sendMessage, deleteMessage } from '@/features/chat/message-service'

afterAll(() => rm(UPLOAD_DIR, { recursive: true, force: true }))

beforeEach(() => resetDb())

// '/uploads/chat/<uuid>.txt' -> ['chat', '<uuid>.txt'] (readUpload takes segments)
const partsOf = (publicPath: string) => publicPath.replace(/^\/uploads\//, '').split('/')

// The brief's mkUser/mkChannel, factored: users (by role) + a channel they all
// joined — mirrors channelWith in chat-messages.test.ts.
async function channelWith(...roles: string[]) {
  const users = await Promise.all(roles.map((role) => makeUser({ role })))
  const ch = await makeChannel()
  await Promise.all(users.map((u) => makeMember(ch.id, u.id)))
  return { ch, users }
}

describe('chat upload ownership recording', () => {
  it('records the uploading user against the minted path', async () => {
    const u = await makeUser()
    const file = new File([new Uint8Array([1, 2, 3])], 'a.txt', { type: 'text/plain' })
    const publicPath = await saveUpload(file, 'chat')
    // What POST /api/chat/attachments does (route wired in the same patch):
    await recordChatUpload(publicPath, u.id)
    const row = await prisma.chatUpload.findUniqueOrThrow({ where: { path: publicPath } })
    expect(row.userId).toBe(u.id)
  })

  it('re-recording the same path is a no-op, not an error (upload retry)', async () => {
    const u = await makeUser()
    const file = new File([new Uint8Array([4, 5])], 'b.txt', { type: 'text/plain' })
    const publicPath = await saveUpload(file, 'chat')
    await recordChatUpload(publicPath, u.id)
    await recordChatUpload(publicPath, u.id)
    const rows = await prisma.chatUpload.findMany({ where: { path: publicPath } })
    expect(rows).toHaveLength(1)
  })
})

describe('sendMessage / deleteMessage attachment ownership', () => {
  it('sendMessage rejects attaching a path uploaded by someone else', async () => {
    const { ch, users: [a, b] } = await channelWith('member', 'member')
    const path = await saveUpload(new File([new Uint8Array([1])], 's.txt', { type: 'text/plain' }), 'chat')
    await recordChatUpload(path, a.id) // A uploaded it
    const r = await sendMessage({
      userId: b.id, conversationId: ch.id, body: 'steal',
      attachments: [{ path, name: 's.txt', mime: 'text/plain', size: 1 }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid')
    expect(await prisma.message.count({ where: { conversationId: ch.id } })).toBe(0) // nothing landed
  })

  it('sendMessage rejects an attachment path with no ownership row (fail-closed)', async () => {
    const { ch, users: [a] } = await channelWith('member')
    const path = await saveUpload(new File([new Uint8Array([7])], 'ghost.txt', { type: 'text/plain' }), 'chat')
    // No recordChatUpload call: the path exists on disk but was never handed to
    // this sender (no ChatUpload row at all) — the guard must fail closed, not
    // treat a missing row as unowned-and-allowed.
    const r = await sendMessage({
      userId: a.id, conversationId: ch.id, body: 'ghost',
      attachments: [{ path, name: 'ghost.txt', mime: 'text/plain', size: 1 }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid')
    expect(await prisma.message.count({ where: { conversationId: ch.id } })).toBe(0) // nothing landed
  })

  it('uploader sends their own file; deleting that message unlinks it and the ownership row', async () => {
    const { ch, users: [a] } = await channelWith('member')
    const path = await saveUpload(new File([new Uint8Array([2])], 'k.txt', { type: 'text/plain' }), 'chat')
    await recordChatUpload(path, a.id)
    const sent = await sendMessage({
      userId: a.id, conversationId: ch.id, body: 'm',
      attachments: [{ path, name: 'k.txt', mime: 'text/plain', size: 1 }],
    })
    if (!sent.ok) throw new Error(sent.message ?? 'send failed')
    expect(await readUpload(partsOf(path))).not.toBeNull()

    expect((await deleteMessage({ messageId: sent.message.id, userId: a.id })).ok).toBe(true)
    expect(await readUpload(partsOf(path))).toBeNull() // owner-of-upload deleted -> unlinked
    expect(await prisma.chatUpload.count({ where: { path } })).toBe(0) // row cleaned up with the file
  })

  it('admin override: an admin deleting another user\'s message unlinks their file', async () => {
    const { ch, users: [a, admin] } = await channelWith('member', 'admin')
    const path = await saveUpload(new File([new Uint8Array([5])], 'adm.txt', { type: 'text/plain' }), 'chat')
    await recordChatUpload(path, a.id)
    const sent = await sendMessage({
      userId: a.id, conversationId: ch.id, body: 'm',
      attachments: [{ path, name: 'adm.txt', mime: 'text/plain', size: 1 }],
    })
    if (!sent.ok) throw new Error(sent.message ?? 'send failed')

    expect((await deleteMessage({ messageId: sent.message.id, userId: admin.id })).ok).toBe(true)
    expect(await readUpload(partsOf(path))).toBeNull()
    expect(await prisma.chatUpload.count({ where: { path } })).toBe(0)
  })

  it('deleteMessage leaves the file when the attachment was uploaded by someone else', async () => {
    // sendMessage now rejects attaching another user's path, so the historical
    // attack shape (uploader differs from message sender) only exists for legacy
    // rows — assert the deleteMessage guard on a forged row inserted directly.
    const { ch, users: [a, b] } = await channelWith('member', 'member')
    const path = await saveUpload(new File([new Uint8Array([3])], 'z.txt', { type: 'text/plain' }), 'chat')
    await recordChatUpload(path, b.id)
    const msg = await prisma.message.create({
      data: {
        conversationId: ch.id, userId: a.id, body: 'x',
        attachments: { create: { path, name: 'z.txt', mime: 'text/plain', size: 1 } },
      },
    })
    expect((await deleteMessage({ messageId: msg.id, userId: a.id })).ok).toBe(true)
    expect(await readUpload(partsOf(path))).not.toBeNull() // b's file survived a's delete
    expect(await prisma.chatUpload.count({ where: { path } })).toBe(1) // b's ownership row intact
  })

  it('legacy uploads with no ownership row still unlink on delete (message-ownership governs)', async () => {
    const { ch, users: [a] } = await channelWith('member')
    const path = await saveUpload(new File([new Uint8Array([6])], 'old.txt', { type: 'text/plain' }), 'chat')
    // Pre-guard shape: an attachment with NO ChatUpload row.
    const msg = await prisma.message.create({
      data: {
        conversationId: ch.id, userId: a.id, body: 'legacy',
        attachments: { create: { path, name: 'old.txt', mime: 'text/plain', size: 1 } },
      },
    })
    expect((await deleteMessage({ messageId: msg.id, userId: a.id })).ok).toBe(true)
    expect(await readUpload(partsOf(path))).toBeNull() // message author owns the message -> unlink allowed
  })
})
