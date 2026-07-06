import { defineConfig } from '@playwright/test'

const TEST_DB = 'postgresql://labhub:labhub@localhost:5432/labhub_test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1, // journeys share one database
  use: { baseURL: 'http://localhost:3100' },
  webServer: {
    command: 'npx prisma migrate deploy && npm run dev -- --port 3100',
    port: 3100,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: TEST_DB,
      DISABLE_JOBS: '1',
      SMTP_HOST: '',
      APP_URL: 'http://localhost:3100',
      BETTER_AUTH_SECRET: 'e2e-secret-0123456789abcdef0123456789abcdef',
    },
  },
})
