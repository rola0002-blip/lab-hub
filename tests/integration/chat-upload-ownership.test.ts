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
import { resetDb, makeUser } from '../factories'
import { saveUpload } from '@/lib/uploads'

afterAll(() => rm(UPLOAD_DIR, { recursive: true, force: true }))

beforeEach(() => resetDb())

describe('chat upload ownership recording', () => {
  it('records the uploading user against the minted path', async () => {
    const u = await makeUser()
    const file = new File([new Uint8Array([1, 2, 3])], 'a.txt', { type: 'text/plain' })
    const publicPath = await saveUpload(file, 'chat')
    // Simulate what POST /api/chat/attachments must now do:
    const { recordChatUpload } = await import('@/features/chat/upload-ownership')
    await recordChatUpload(publicPath, u.id)
    const row = await prisma.chatUpload.findUniqueOrThrow({ where: { path: publicPath } })
    expect(row.userId).toBe(u.id)
  })

  it('re-recording the same path is a no-op, not an error (upload retry)', async () => {
    const u = await makeUser()
    const file = new File([new Uint8Array([4, 5])], 'b.txt', { type: 'text/plain' })
    const publicPath = await saveUpload(file, 'chat')
    const { recordChatUpload } = await import('@/features/chat/upload-ownership')
    await recordChatUpload(publicPath, u.id)
    await recordChatUpload(publicPath, u.id)
    const rows = await prisma.chatUpload.findMany({ where: { path: publicPath } })
    expect(rows).toHaveLength(1)
  })
})
