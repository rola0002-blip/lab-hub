import { defineConfig } from 'vitest/config'
import path from 'node:path'

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://labhub:labhub@localhost:5432/labhub_test'
process.env.DISABLE_JOBS = '1'
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'integration-test-secret-0123456789abcdef'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // `import 'server-only'` throws under vitest's default resolution; map it
      // to the package's empty stub so server modules are testable.
      'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/integration/setup.ts'],
    fileParallelism: false, // tests share one database; run files serially
    testTimeout: 20000,
    // Coverage `include` matches vitest.config.ts so the combined (unit +
    // integration) blob-merged report enforces one consistent gate; the
    // service/DB modules under src/features + src/lib are exercised here, not in
    // the unit run. Thresholds are applied only on the merged run — see the
    // `coverage` script in package.json.
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/features/**'],
      exclude: ['**/*.test.ts'],
    },
  },
})
