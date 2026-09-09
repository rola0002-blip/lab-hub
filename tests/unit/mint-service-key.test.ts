import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mintToken, sha256hex, mintServiceKey, listServiceKeys, revokeServiceKey } from '../../scripts/mint-service-key.mjs'

// The script's core logic is db-injected, so a plain stub exercises it with no
// Prisma/DB import at all (the release-lib.mjs unit-test pattern).
const makeDb = (over: Record<string, unknown> = {}) => ({
  serviceKey: {
    create: vi.fn(async ({ data }: { data: { name: string; tokenHash: string } }) => ({ id: 'k1', createdAt: new Date(), ...data })),
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => null),
    update: vi.fn(async () => ({})),
    ...over,
  },
})

describe('mintToken / sha256hex', () => {
  it('mints labhub_-prefixed base64url tokens (43 chars for 32 bytes)', () => {
    expect(mintToken()).toMatch(/^labhub_[A-Za-z0-9_-]{43}$/)
    expect(mintToken()).not.toBe(mintToken())
  })

  it('hashes with sha256, hex digest', () => {
    expect(sha256hex('abc')).toBe(createHash('sha256').update('abc').digest('hex'))
    expect(sha256hex('abc')).toHaveLength(64)
  })
})

describe('mintServiceKey', () => {
  it('stores only the sha256 of the token — never the plaintext', async () => {
    const db = makeDb()
    const r = await mintServiceKey(db, 'labhub-mcp')
    expect(r.token).toMatch(/^labhub_/)
    expect(r.name).toBe('labhub-mcp')
    expect(db.serviceKey.create).toHaveBeenCalledWith({ data: { name: 'labhub-mcp', tokenHash: sha256hex(r.token) } })
    const persisted = JSON.stringify(db.serviceKey.create.mock.calls)
    expect(persisted).not.toContain(r.token)
  })

  it('propagates duplicate-name rejections (P2002) to the caller', async () => {
    const db = makeDb({ create: vi.fn(async () => { throw new Error('Unique constraint failed on the fields: (`name`)') }) })
    await expect(mintServiceKey(db, 'dup')).rejects.toThrow(/constraint/i)
  })
})

describe('listServiceKeys', () => {
  it('selects the CLI columns in creation order', async () => {
    const db = makeDb()
    await listServiceKeys(db)
    expect(db.serviceKey.findMany).toHaveBeenCalledWith({
      select: { id: true, name: true, createdAt: true, lastUsedAt: true, revokedAt: true },
      orderBy: { createdAt: 'asc' },
    })
  })
})

describe('revokeServiceKey', () => {
  it('reports missing for an unknown name', async () => {
    const db = makeDb()
    expect(await revokeServiceKey(db, 'nope')).toEqual({ status: 'missing' })
    expect(db.serviceKey.update).not.toHaveBeenCalled()
  })

  it('is idempotent: an already-revoked key is left untouched', async () => {
    const db = makeDb({ findUnique: vi.fn(async () => ({ id: 'k1', name: 'k', revokedAt: new Date() })) })
    expect(await revokeServiceKey(db, 'k')).toEqual({ status: 'already-revoked', key: expect.objectContaining({ id: 'k1' }) })
    expect(db.serviceKey.update).not.toHaveBeenCalled()
  })

  it('stamps revokedAt on an active key', async () => {
    const db = makeDb({ findUnique: vi.fn(async () => ({ id: 'k1', name: 'k', revokedAt: null })) })
    expect(await revokeServiceKey(db, 'k')).toEqual({ status: 'revoked', key: expect.objectContaining({ id: 'k1' }) })
    expect(db.serviceKey.update).toHaveBeenCalledWith({ where: { id: 'k1' }, data: { revokedAt: expect.any(Date) } })
  })
})
