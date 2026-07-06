import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // src/lib/env.ts eagerly parses process.env at import time; supply the one
    // required var so unit modules import without a real .env present.
    env: { DATABASE_URL: 'postgresql://localhost:5432/labhub_test' },
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/features/**'],
      exclude: ['**/*.test.ts'],
      thresholds: { lines: 85, functions: 85, branches: 80 },
    },
  },
})
