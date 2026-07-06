import { defineConfig } from 'vitest/config'
import path from 'node:path'

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://labhub:labhub@localhost:5432/labhub_test'
process.env.DISABLE_JOBS = '1'
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'integration-test-secret-0123456789abcdef'

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/integration/setup.ts'],
    fileParallelism: false, // tests share one database; run files serially
    testTimeout: 20000,
  },
})
