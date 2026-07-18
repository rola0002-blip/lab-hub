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
      // The specs that don't set a per-context client IP (journeys, issues) all sign in
      // from one source IP, sharing better-auth's single per-IP sign-in/up bucket. At the
      // default 10/60s the runner self-throttles (a sign-in 429s → the redirect never
      // fires → waitForURL hangs). Raise the ceiling for the test server via the documented
      // AUTH_RATE_LIMIT_MAX knob (auth-rate-limit.ts) — the limiter stays enabled.
      AUTH_RATE_LIMIT_MAX: '1000',
    },
  },
})
