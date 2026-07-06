import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default('http://localhost:3000'),
  BETTER_AUTH_SECRET: z.string().min(32),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default('LabHub <no-reply@localhost>'),
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
