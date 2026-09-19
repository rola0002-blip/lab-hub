import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import { resetDb, seedSystem } from '../factories'
import { COLOSSUS_BOT_ID, LAB_UPDATES_CHANNEL_ID } from '@/features/bot/ids'

// getSessionUser reads request headers via next/headers(), which throws outside a
// Next request scope when the route handler is invoked directly
// (next-dynamic-api-wrong-context). Mock only that store: the REAL getSessionUser —
// session lookup AND the bearer fallback — runs against the real DB, and the route
// handler under test is real too. The handler's own Request carries only the JSON
// body; the Authorization header goes through the mocked store, exactly where
// getSessionUser looks.
const h = vi.hoisted(() => ({ current: new Headers() }))
vi.mock('next/headers', () => ({ headers: async () => h.current }))

import { POST as sendMessageRoute } from '@/app/api/chat/messages/route'
import { resolveServiceKeyUser } from '@/lib/service-key'
import { mintServiceKey, revokeServiceKey, sha256hex } from '../../scripts/mint-service-key.mjs'

const TOKEN = `labhub_${'a'.repeat(43)}`
const HASH = createHash('sha256').update(TOKEN).digest('hex')

const call = async (authorization: string | null, body: unknown) => {
  h.current = new Headers(authorization ? { authorization } : {})
  return sendMessageRoute(new Request('http://t/api/chat/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
}

const until = async (fn: () => Promise<boolean>, ms = 2000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await fn()) return; await new Promise((r) => setTimeout(r, 15)) }
}

describe('service-key bearer auth (through getSessionUser on a real route)', () => {
  beforeEach(async () => {
    await resetDb()
    await seedSystem()
  })

  it('a valid bearer token acts as the LabHub Bot', async () => {
    await prisma.serviceKey.create({ data: { name: 'test-key', tokenHash: HASH } })
    const res = await call(`Bearer ${TOKEN}`, { conversationId: LAB_UPDATES_CHANNEL_ID, body: 'via service key' })
    expect(res.status).toBe(201)
    const { message } = await res.json()
    expect(message.author.id).toBe(COLOSSUS_BOT_ID) // authored BY the bot, not just any user
    // lastUsedAt is fire-and-forget; it lands shortly after auth resolution.
    await until(async () => (await prisma.serviceKey.findFirst())?.lastUsedAt != null)
    expect((await prisma.serviceKey.findFirst())?.lastUsedAt).not.toBeNull()
  })

  it('an unknown token is rejected like a missing session', async () => {
    expect((await call(`Bearer ${TOKEN}`, { conversationId: LAB_UPDATES_CHANNEL_ID, body: 'x' })).status).toBe(401)
  })

  it('a revoked token is rejected', async () => {
    await prisma.serviceKey.create({ data: { name: 'test-key', tokenHash: HASH, revokedAt: new Date() } })
    expect((await call(`Bearer ${TOKEN}`, { conversationId: LAB_UPDATES_CHANNEL_ID, body: 'x' })).status).toBe(401)
  })

  it('malformed Authorization headers are rejected (wrong scheme, wrong prefix, bare token)', async () => {
    await prisma.serviceKey.create({ data: { name: 'test-key', tokenHash: HASH } })
    for (const bad of [`bearer ${TOKEN}`, `Basic ${TOKEN}`, `Bearer ${'b'.repeat(43)}`, TOKEN]) {
      expect((await call(bad, { conversationId: LAB_UPDATES_CHANNEL_ID, body: 'x' })).status).toBe(401)
    }
  })

  it('no session cookie and no header stays 401 (the cookie path is unchanged)', async () => {
    expect((await call(null, { conversationId: LAB_UPDATES_CHANNEL_ID, body: 'x' })).status).toBe(401)
  })

  it('a banned bot short-circuits every service key (Task 10)', async () => {
    await prisma.serviceKey.create({ data: { name: 'test-key', tokenHash: HASH } })
    await prisma.user.update({ where: { id: COLOSSUS_BOT_ID }, data: { banned: true } })
    expect(await resolveServiceKeyUser(`Bearer ${TOKEN}`)).toBeNull()
    expect((await call(`Bearer ${TOKEN}`, { conversationId: LAB_UPDATES_CHANNEL_ID, body: 'x' })).status).toBe(401)
  })
})

describe('mint-service-key module (real DB)', () => {
  beforeEach(async () => {
    await resetDb()
    await seedSystem()
  })

  it('mint stores the hash, not the plaintext; the minted token authenticates as the bot; revoke is idempotent', async () => {
    const { token } = await mintServiceKey(prisma, 'labhub-mcp')
    const row = await prisma.serviceKey.findUniqueOrThrow({ where: { name: 'labhub-mcp' } })
    expect(row.tokenHash).toBe(sha256hex(token))
    expect(row.tokenHash).not.toContain(token)
    expect(row.lastUsedAt).toBeNull()
    expect(await resolveServiceKeyUser(`Bearer ${token}`)).toMatchObject({ id: COLOSSUS_BOT_ID, role: 'member' })
    expect((await revokeServiceKey(prisma, 'labhub-mcp')).status).toBe('revoked')
    expect((await revokeServiceKey(prisma, 'labhub-mcp')).status).toBe('already-revoked')
    expect(await resolveServiceKeyUser(`Bearer ${token}`)).toBeNull() // revoked now
  })

  it('mint refuses a duplicate name (unique constraint)', async () => {
    await mintServiceKey(prisma, 'same')
    await expect(mintServiceKey(prisma, 'same')).rejects.toThrow()
  })
})
