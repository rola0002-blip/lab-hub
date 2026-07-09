import { readFileSync, readdirSync, existsSync, mkdtempSync, statSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { buildImportPlan, type SlackUser, type SlackChannel, type SlackMsg } from '../src/features/chat/slack-import'
import type { ApplyResult } from '../src/features/chat/slack-import-apply'

// Thin CLI: unzip/read a Slack export → buildImportPlan (pure) → applyImportPlan
// (DB). Accepts a `.zip` path OR an already-extracted directory.
//   npm run import:slack -- /path/to/export.zip
//   npm run import:slack -- /path/to/extracted-dir

// Load .env WITHOUT clobbering an explicit env var (mirrors prisma.config.ts).
// Must run before importing src/lib/db.ts, which reads DATABASE_URL at load —
// hence applyImportPlan/prisma are dynamically imported below.
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

function resolveExportDir(arg: string): string {
  const abs = path.resolve(arg)
  if (arg.toLowerCase().endsWith('.zip')) {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'slack-import-'))
    execFileSync('unzip', ['-o', abs, '-d', tmp], { stdio: 'ignore' })
    return findExportRoot(tmp)
  }
  return findExportRoot(abs)
}

// Slack exports keep users.json/channels.json at the root; a zip may nest them
// one folder deep.
function findExportRoot(dir: string): string {
  if (existsSync(path.join(dir, 'users.json')) && existsSync(path.join(dir, 'channels.json'))) return dir
  for (const name of readdirSync(dir)) {
    const sub = path.join(dir, name)
    if (statSync(sub).isDirectory() && existsSync(path.join(sub, 'users.json'))) return sub
  }
  throw new Error(`No Slack export (users.json + channels.json) found under ${dir}`)
}

function readExport(dir: string) {
  const users = JSON.parse(readFileSync(path.join(dir, 'users.json'), 'utf8')) as SlackUser[]
  const channels = JSON.parse(readFileSync(path.join(dir, 'channels.json'), 'utf8')) as SlackChannel[]
  const messagesByChannel: Record<string, SlackMsg[]> = {}
  for (const ch of channels) {
    const chDir = path.join(dir, ch.name)
    const msgs: SlackMsg[] = []
    if (existsSync(chDir)) {
      for (const f of readdirSync(chDir).filter((n) => n.endsWith('.json')).sort()) {
        msgs.push(...(JSON.parse(readFileSync(path.join(chDir, f), 'utf8')) as SlackMsg[]))
      }
    }
    messagesByChannel[ch.id] = msgs
  }
  return { users, channels, messagesByChannel }
}

function printSummary(r: ApplyResult, planTotal: number) {
  const rows: [string, number][] = [
    ['users matched', r.matched],
    ['placeholders created', r.placeholders],
    ['channels', r.channels],
    ['plan messages (total)', planTotal],
    ['messages inserted', r.messages],
    ['messages skipped (dupes)', r.skipped],
    ['messages dropped', r.dropped],
    ['reactions', r.reactions],
  ]
  console.log('\nSlack import complete')
  console.log('─'.repeat(36))
  for (const [label, n] of rows) console.log(`${label.padEnd(27)}${n}`)
  // Reconciliation identity so an operator can verify nothing vanished at cutover.
  const accounted = r.messages + r.skipped + r.dropped
  console.log('─'.repeat(36))
  console.log(`reconcile  ${r.messages} + ${r.skipped} + ${r.dropped} = ${accounted} (plan ${planTotal})`)
  console.log(accounted === planTotal ? 'planTotal reconciles ✓' : 'planTotal MISMATCH ✗')
  console.log('')
}

async function main() {
  const arg = process.argv[2]
  if (!arg) {
    console.error('usage: npm run import:slack -- <export.zip | extracted-dir>')
    process.exit(1)
  }
  loadEnv()

  const dir = resolveExportDir(arg)
  const input = readExport(dir)
  const plan = buildImportPlan(input)

  // Dynamic imports: these load src/lib/db.ts, which reads DATABASE_URL at import
  // time — so they must resolve only after loadEnv() has populated process.env.
  const { applyImportPlan } = await import('../src/features/chat/slack-import-apply')
  const { prisma } = await import('../src/lib/db')

  try {
    printSummary(await applyImportPlan(plan), plan.messages.length)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
