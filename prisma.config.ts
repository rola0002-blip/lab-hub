import { readFileSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, env } from 'prisma/config'

// Prisma 7 removed automatic .env loading and moved the datasource connection
// URL out of schema.prisma into this config file. Load .env here (zero-dep) so
// `prisma migrate dev` works locally; the integration harness passes
// DATABASE_URL directly via process.env, so this only fills in gaps.
if (!process.env.DATABASE_URL) {
  try {
    const envFile = readFileSync(path.resolve(__dirname, '.env'), 'utf8')
    for (const line of envFile.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      const key = m[1]
      // strip inline comments and surrounding quotes
      let val = m[2].replace(/\s+#.*$/, '').trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!(key in process.env)) process.env[key] = val
    }
  } catch {
    // no .env present; rely on the ambient environment
  }
}

// Prisma 7 moved the datasource connection URL out of schema.prisma and into
// this config file. The CLI (migrate/introspect) reads `datasource.url` here;
// runtime connection is handled in src/lib/db.ts.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
