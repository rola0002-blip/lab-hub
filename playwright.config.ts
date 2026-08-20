import { defineConfig } from '@playwright/test'

// Overridable via the environment (same convention as vitest.integration.config.ts)
// so machines whose local postgres doesn't use the labhub:labhub credential can
// point both the dev server and the helpers' Prisma client at the same test DB.
const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://labhub:labhub@localhost:5432/labhub_test'

export default defineConfig({
  testDir: './e2e',
  timeout: Number(process.env.E2E_TEST_TIMEOUT_MS ?? 60_000),
  // Env-overridable expect budget (CI sets E2E_EXPECT_TIMEOUT_MS): ubuntu-latest's
  // 2-core dev-mode runner can take >5s to round-trip a mutation and re-render, so
  // the first CI run failed three specs at the 5s default.
  expect: { timeout: Number(process.env.E2E_EXPECT_TIMEOUT_MS ?? 5_000) },
  workers: 1, // journeys share one database
  use: { baseURL: 'http://localhost:3100' },
  webServer: {
    // CI (E2E_WEB_SERVER=build) serves a production build: `next dev`'s
    // on-demand route/action compilation makes first-hit waits exceed any
    // sane expect budget on 2-core runners. Local runs keep the dev server.
    command: process.env.E2E_WEB_SERVER === 'build'
      ? 'npx prisma migrate deploy && npm run build && npm run start -- --port 3100'
      : 'npx prisma migrate deploy && npm run dev -- --port 3100',
    port: 3100,
    reuseExistingServer: false,
    timeout: process.env.E2E_WEB_SERVER === 'build' ? 600_000 : 120_000,
    env: {
      DATABASE_URL: TEST_DB,
      DISABLE_JOBS: '1',
      SMTP_HOST: '',
      APP_URL: 'http://localhost:3100',
      BETTER_AUTH_SECRET: 'e2e-secret-0123456789abcdef0123456789abcdef',
      // Blank (not omitted): Playwright merges webServer.env over this process's
      // env, and Next.js's dotenv never overrides an already-set variable — so an
      // empty string PRE-SEEDS the var and shields the dev server from a
      // machine/.env SETUP_TOKEN. setup-token.ts treats '' exactly like unset
      // (t && t.length > 0 ⇒ gate disabled), so the wizard shows no token field
      // and runWizard needs no token step.
      SETUP_TOKEN: '',
      // A dedicated relative uploads dir: uploadsDir() is
      // path.resolve(UPLOADS_DIR ?? './data/uploads') — an empty string is NOT
      // nullish, so '' would resolve to the CWD; and inheriting a machine's
      // absolute UPLOADS_DIR (a container path) breaks chat upload POSTs locally.
      // './data/e2e-uploads' resolves against the repo root (the webServer cwd),
      // is mkdir'd on demand by saveUpload, and is gitignored via the `data/`
      // pattern.
      UPLOADS_DIR: './data/e2e-uploads',
      // Same blank-out for the trusted-IP header: a machine/.env value of
      // cf-connecting-ip makes better-auth ignore the specs' per-context
      // x-forwarded-for IPs (every context would share one rate-limit bucket).
      // trustedIpConfig('') behaves exactly like unset (dev default).
      AUTH_TRUSTED_IP_HEADER: '',
      // The specs that don't set a per-context client IP (journeys, issues) all sign in
      // from one source IP, sharing better-auth's single per-IP sign-in/up bucket. At the
      // default 10/60s the runner self-throttles (a sign-in 429s → the redirect never
      // fires → waitForURL hangs). Raise the ceiling for the test server via the documented
      // AUTH_RATE_LIMIT_MAX knob (auth-rate-limit.ts) — the limiter stays enabled.
      AUTH_RATE_LIMIT_MAX: '1000',
    },
  },
})
