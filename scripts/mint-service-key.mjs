#!/usr/bin/env node
// Mint / list / revoke service API keys (the service-api-key + labhub-mcp
// design, 2026-09-09). A key is a bearer credential that acts as the LabHub
// Bot; only the sha256 of the token is stored, so the FULL token is printed
// exactly once, at mint time — it cannot be recovered later.
//
//   node scripts/mint-service-key.mjs mint --name <name>
//   node scripts/mint-service-key.mjs list
//   node scripts/mint-service-key.mjs revoke <name>
//
// Core logic is exported with the db client injected and unit-tested in
// tests/unit/mint-service-key.test.ts (the release-lib.mjs pattern); main()
// below stays a thin CLI.

import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const mintToken = () => `labhub_${randomBytes(32).toString('base64url')}`

export const sha256hex = (t) => createHash('sha256').update(t).digest('hex')

// Mint a key; rejects (Prisma P2002) on a duplicate name — the CLI surfaces that.
export async function mintServiceKey(db, name) {
  const token = mintToken()
  const key = await db.serviceKey.create({ data: { name, tokenHash: sha256hex(token) } })
  return { id: key.id, name: key.name, token }
}

export function listServiceKeys(db) {
  return db.serviceKey.findMany({
    select: { id: true, name: true, createdAt: true, lastUsedAt: true, revokedAt: true },
    orderBy: { createdAt: 'asc' },
  })
}

// Idempotent revoke; the discriminated status lets the CLI report precisely.
export async function revokeServiceKey(db, name) {
  const key = await db.serviceKey.findUnique({ where: { name } })
  if (!key) return { status: 'missing' }
  if (key.revokedAt) return { status: 'already-revoked', key }
  await db.serviceKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } })
  return { status: 'revoked', key }
}

// Load .env WITHOUT clobbering an explicit env var (mirrors prisma.config.ts) —
// must run before the Prisma client is constructed with DATABASE_URL.
function loadEnv() {
  try {
    const envFile = readFileSync(path.resolve(process.cwd(), '.env'), 'utf8')
    for (const line of envFile.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      let val = m[2].replace(/\s+#.*$/, '').trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!(m[1] in process.env)) process.env[m[1]] = val
    }
  } catch {
    // no .env present; rely on the ambient environment
  }
}

const iso = (d) => (d ? new Date(d).toISOString() : '-')

async function main(argv) {
  loadEnv()
  const [cmd, ...rest] = argv
  const { PrismaClient } = await import('@prisma/client')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  try {
    if (cmd === 'mint' && rest[0] === '--name' && rest[1]) {
      try {
        const { id, name, token } = await mintServiceKey(db, rest[1])
        console.log(`minted service key "${name}" (id: ${id})`)
        console.log(`token (shown ONCE — store it now): ${token}`)
      } catch (e) {
        if (e?.code === 'P2002') {
          console.error(`a service key named "${rest[1]}" already exists — pick another name or revoke it first`)
          process.exitCode = 1
        } else throw e
      }
    } else if (cmd === 'list') {
      const keys = await listServiceKeys(db)
      if (keys.length === 0) return console.log('no service keys')
      console.log('id\tname\tcreated\tlastUsed\trevoked')
      for (const k of keys) console.log(`${k.id}\t${k.name}\t${iso(k.createdAt)}\t${iso(k.lastUsedAt)}\t${iso(k.revokedAt)}`)
    } else if (cmd === 'revoke' && rest[0]) {
      const r = await revokeServiceKey(db, rest[0])
      if (r.status === 'missing') {
        console.error(`no service key named "${rest[0]}"`)
        process.exitCode = 1
      } else if (r.status === 'already-revoked') {
        console.log(`"${r.key.name}" (id: ${r.key.id}) is already revoked — nothing to do`)
      } else {
        console.log(`revoked "${r.key.name}" (id: ${r.key.id})`)
      }
    } else {
      console.error('usage: node scripts/mint-service-key.mjs mint --name <name> | list | revoke <name>')
      process.exitCode = 1
    }
  } finally {
    await db.$disconnect()
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  await main(process.argv.slice(2))
}
