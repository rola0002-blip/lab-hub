import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // `import 'server-only'` throws under vitest's default resolution; map it
      // to the package's empty stub so server modules are unit-testable.
      'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js'),
    },
  },
  test: {
    environment: 'node',
    // Colocated pure-module tests under src/, plus standalone unit tests under
    // tests/unit/ (e.g. the roving-focus helper). Integration tests live in
    // tests/integration/ and run via vitest.integration.config.ts.
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    // src/lib/env.ts eagerly parses process.env at import time; supply the
    // required vars so unit modules import without a real .env present.
    env: {
      DATABASE_URL: 'postgresql://localhost:5432/labhub_test',
      BETTER_AUTH_SECRET: 'unit-test-secret-0123456789abcdef',
    },
    // Thresholds live on the merged run only (see package.json `coverage`): the
    // 85% gate spans src/lib + src/features exercised by BOTH the unit run (pure
    // modules) and the integration run (services/DB). Per-run blobs must not fail
    // on thresholds, so they are applied via CLI flags on `--merge-reports`.
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/features/**'],
      exclude: ['**/*.test.ts'],
    },
  },
})
