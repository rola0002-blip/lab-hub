import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default('http://localhost:3000'),
  BETTER_AUTH_SECRET: z.string().min(32),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default('COLOSSUS <no-reply@localhost>'),
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  // Max sign-in + sign-up attempts per 60 s in better-auth's per-IP rate limiter
  // (src/lib/auth.ts). Deploy-tunable because behind the LAN beta's directly-published
  // Docker port every client shares ONE gateway source IP, so this bucket is lab-wide, not
  // per-user (see .env.example + docs/ops/windows-server.md). Default 10 preserves the
  // dev/e2e behaviour; a LAN beta should raise it (e.g. 100).
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  DISABLE_JOBS: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
})

export type Env = z.infer<typeof schema>

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const r = schema.safeParse(raw)
  if (!r.success) throw new Error(`Invalid environment: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')} (check DATABASE_URL, BETTER_AUTH_SECRET, and .env)`)
  return r.data
}

export const env: Env = parseEnv(process.env)
