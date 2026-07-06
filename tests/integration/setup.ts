import { execSync } from 'node:child_process'

export default function setup() {
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL! },
    stdio: 'inherit',
  })
}
