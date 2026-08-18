// scripts/mark-feedback-planned.ts
// One-off: roll the 12 accepted wave-3 feedback items to PLANNED via the service
// so each author gets their decision bell. Idempotent: setFeedbackStatus no-ops
// on same status. Never raw SQL.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { SessionUser } from '../src/lib/session'

// Load .env WITHOUT clobbering an explicit env var (mirrors prisma.config.ts and
// import-slack.ts — the established script precedent; shell `source` mis-parses
// SMTP_FROM's unquoted angle brackets). The service tree validates the full env
// at import time, so this must run before the dynamic imports below.
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

// The service tree `import 'server-only'`, which throws outside a bundler (no
// React alias under plain tsx). Seed the require cache with an inert stub
// BEFORE the service loads — same trick class as import-slack.ts's dynamic
// imports, which exist for the same load-order reason.
function stubServerOnly() {
  const req = createRequire(import.meta.url)
  const path = req.resolve('server-only')
  req.cache[path] = { id: path, filename: path, loaded: true, exports: {} } as never
}

// The exact 12 accepted wave-3 items (reviewed 2026-08-18) — explicit ids, never
// "everything NEW", so late human submissions can't be swept up by a re-run.
const IDS = [
  'cmspkxf7p000j01ldvdnksust',
  'cmspl8dal000r01ld8cv2atu7',
  'cmsr6mslk003z01ld1fs6nv0d',
  'cmsr6xnvh004k01ld0e0au7ce',
  'cmsr74749004s01ldwb02tziv',
  'cmsr786oe005001ldy02yn0xy',
  'cmsslcli4006q01ld5hl6kztr',
  'cmssmm8ar007101ldgx6u82wi',
  'cmswk1ymk008101ldtip2spcv',
  'cmswniezw008901ld40817ps0',
  'cmswnx9z3008h01ld3qmczyts',
  'cmsy5xl9q009t01ldx9bs62vo',
]

async function main() {
  loadEnv()
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required (run: set -a; source .env; set +a)')
  stubServerOnly()
  // Dynamic imports: must resolve only after the server-only stub is seeded.
  const { prisma } = await import('../src/lib/db')
  const { setFeedbackStatus } = await import('../src/features/feedback/feedback-service')
  const admin = await prisma.user.findFirst({ where: { role: 'admin', isSystem: false, banned: false } })
  if (!admin) throw new Error('No admin user found.')
  const actor: SessionUser = { id: admin.id, name: admin.name, email: admin.email, role: 'admin' }
  for (const id of IDS) {
    const row = await prisma.feedback.findUnique({ where: { id }, select: { id: true, status: true } })
    if (!row) { console.log(`MISSING ${id}`); continue }
    if (row.status !== 'NEW') { console.log(`SKIP ${id} (${row.status})`); continue }
    await setFeedbackStatus(actor, id, 'PLANNED')
    console.log(`PLANNED ${id}`)
  }
  console.log('Done.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
