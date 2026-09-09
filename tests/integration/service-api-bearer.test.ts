import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import { resetDb, seedSystem, makeProject } from '../factories'

// The service-key-auth.test.ts posture: mock only the next/headers store so the
// REAL getSessionUser — session lookup and bearer fallback — runs against the
// real DB through the new route handlers under test.
const h = vi.hoisted(() => ({ current: new Headers() }))
vi.mock('next/headers', () => ({ headers: async () => h.current }))

import { GET as projectsGET, POST as projectsPOST } from '@/app/api/projects/route'

const TOKEN = `labhub_${'c'.repeat(43)}`
const HASH = createHash('sha256').update(TOKEN).digest('hex')

describe('service-key bearer auth on the new REST routes', () => {
  beforeEach(async () => {
    await resetDb()
    await seedSystem()
  })

  it('a minted key authenticates GET /api/projects as the LabHub Bot member', async () => {
    await makeProject({ name: 'Visible to bots' })
    await prisma.serviceKey.create({ data: { name: 'mcp', tokenHash: HASH } })
    h.current = new Headers({ authorization: `Bearer ${TOKEN}` })
    const res = await projectsGET()
    expect(res.status).toBe(200)
    expect((await res.json()).projects).toHaveLength(1)
  })

  it('a minted key lets the bot create a project as a member (201)', async () => {
    await prisma.serviceKey.create({ data: { name: 'mcp', tokenHash: HASH } })
    h.current = new Headers({ authorization: `Bearer ${TOKEN}` })
    const res = await projectsPOST(new Request('http://t/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Bot project' }),
    }))
    expect(res.status).toBe(201)
    const { project } = await res.json()
    expect(project.name).toBe('Bot project')
    expect(await prisma.project.count()).toBe(1)
  })

  it('without a key the new routes stay 401 (the cookie path is unchanged)', async () => {
    h.current = new Headers()
    expect((await projectsGET()).status).toBe(401)
  })
})
