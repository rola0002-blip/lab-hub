import { execSync } from 'node:child_process'

export default function setup() {
  // Guard twice (vitest.integration.config.ts already checks): a mis-set
  // TEST_DATABASE_URL once wiped production via this migrate-deploy step.
  const url = process.env.DATABASE_URL!
  const name = (() => { try { return new URL(url).pathname.replace(/^\//, '') } catch { return url } })()
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run integration setup against database "${name}" — TEST_DATABASE_URL must target a *_test database.`)
  }
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  })
}
