import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'

// service-key pulls the prisma singleton at import; the unit suite runs with no
// DB — stub the module (we test the pure resolution logic; the real-DB path is
// covered by tests/integration/service-key-auth.test.ts).
const db = vi.hoisted(() => ({
  serviceKey: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
}))
vi.mock('@/lib/db', () => ({ prisma: db }))

import { resolveServiceKeyUser } from '@/lib/service-key'
import { COLOSSUS_BOT_ID } from '@/features/bot/ids'

const TOKEN = `labhub_${'A'.repeat(43)}` // 32 bytes → 43 base64url chars
const HASH = createHash('sha256').update(TOKEN).digest('hex')
const KEY = { id: 'key1', name: 'k', tokenHash: HASH, revokedAt: null }
const BOT = { name: 'LabHub Bot', email: 'bot@colossus.local' }

describe('resolveServiceKeyUser', () => {
  beforeEach(() => {
    db.serviceKey.findFirst.mockReset().mockResolvedValue(null)
    db.serviceKey.update.mockReset().mockResolvedValue({})
    db.user.findUnique.mockReset().mockResolvedValue(BOT)
  })

  it('resolves a valid bearer token to the LabHub Bot as a member', async () => {
    db.serviceKey.findFirst.mockResolvedValue(KEY)
    expect(await resolveServiceKeyUser(`Bearer ${TOKEN}`)).toEqual({
      id: COLOSSUS_BOT_ID, name: 'LabHub Bot', email: 'bot@colossus.local', role: 'member',
    })
    // Lookup is by sha256 of the token, active keys only.
    expect(db.serviceKey.findFirst).toHaveBeenCalledWith({ where: { tokenHash: HASH, revokedAt: null } })
    expect(db.serviceKey.update).toHaveBeenCalledWith({ where: { id: 'key1' }, data: { lastUsedAt: expect.any(Date) } })
  })

  it('treats lastUsedAt as fire-and-forget: a failed update never fails the request', async () => {
    db.serviceKey.findFirst.mockResolvedValue(KEY)
    db.serviceKey.update.mockRejectedValue(new Error('db gone'))
    expect((await resolveServiceKeyUser(`Bearer ${TOKEN}`))?.id).toBe(COLOSSUS_BOT_ID)
  })

  it('returns null for absent, malformed and wrong-scheme headers without touching the DB', async () => {
    for (const h of [null, undefined, '', 'Basic dXNlcg==', 'bearer labhub_x', `bearer ${TOKEN}`, 'Bearer not-a-service-token', 'Bearer labhub_bad!chars', `Bearer  ${TOKEN}`, 'Bearer labhub_', TOKEN]) {
      expect(await resolveServiceKeyUser(h as string | null)).toBeNull()
    }
    expect(db.serviceKey.findFirst).not.toHaveBeenCalled()
  })

  it('returns null for an unknown token hash', async () => {
    expect(await resolveServiceKeyUser(`Bearer ${TOKEN}`)).toBeNull()
    expect(db.serviceKey.findFirst).toHaveBeenCalledTimes(1)
    expect(db.user.findUnique).not.toHaveBeenCalled()
  })

  it('returns null when the bot row is missing', async () => {
    db.serviceKey.findFirst.mockResolvedValue(KEY)
    db.user.findUnique.mockResolvedValue(null)
    expect(await resolveServiceKeyUser(`Bearer ${TOKEN}`)).toBeNull()
    expect(db.serviceKey.update).not.toHaveBeenCalled()
  })
})
