import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resetDb, makeUser, makeChannel, makeMember } from '../factories'
import { resetRate } from '@/features/chat/rate-limit'
import { _resetForTests } from '@/lib/events'
import { saveUpload } from '@/lib/uploads'
import { sendMessage } from '@/features/chat/message-service'

const mockUser = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: string } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => mockUser.current,
  requireUser: async () => mockUser.current,
  requireAdmin: async () => mockUser.current,
}))

import { GET as uploadRoute } from '@/app/uploads/[...path]/route'

// '/uploads/chat/<uuid>.pdf' -> ['chat', '<uuid>.pdf'] (the catch-all route param)
const partsOf = (publicPath: string) => publicPath.replace(/^\/uploads\//, '').split('/')
const reqFor = (publicPath: string, params: string[]) =>
  uploadRoute(new Request('http://t' + publicPath), { params: Promise.resolve({ path: params }) })

describe('attachment serving', () => {
  beforeEach(async () => { await resetDb(); resetRate(); mockUser.current = null })
  afterEach(() => _resetForTests())

  async function seedChatAttachment() {
    const author = await makeUser()
    const ch = await makeChannel()
    await makeMember(ch.id, author.id)
    const path = await saveUpload(new File([new Uint8Array(64)], 'secret.pdf', { type: 'application/pdf' }), 'chat')
    const sent = await sendMessage({
      userId: author.id, conversationId: ch.id, body: 'see attached',
      attachments: [{ path, name: 'secret.pdf', mime: 'application/pdf', size: 64 }],
    })
    if (!sent.ok) throw new Error('setup: send failed')
    return { author, ch, path, messageId: sent.message.id }
  }

  it('chat attachments are membership-gated: 401 signed out, 403 non-member, 200 member (private no-store)', async () => {
    const { author, path } = await seedChatAttachment()
    const parts = partsOf(path)

    mockUser.current = null
    expect((await reqFor(path, parts)).status).toBe(401)

    const outsider = await makeUser()
    mockUser.current = { ...outsider, role: outsider.role }
    expect((await reqFor(path, parts)).status).toBe(403)

    mockUser.current = { ...author, role: author.role }
    const ok = await reqFor(path, parts)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('Cache-Control')).toBe('private, no-store')
    expect(ok.headers.get('Content-Type')).toBe('application/pdf')
  })

  it('SP1 public assets (logo/equipment) stay public and unauthenticated', async () => {
    const logoPath = await saveUpload(new File([new Uint8Array(64)], 'logo.png', { type: 'image/png' }), 'logo')
    mockUser.current = null // signed out
    const r = await reqFor(logoPath, partsOf(logoPath))
    expect(r.status).toBe(200)
    expect(r.headers.get('Cache-Control')).toBe('public, max-age=86400')
  })
})
