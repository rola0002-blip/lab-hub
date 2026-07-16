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
  // (src/lib/auth.ts). Behind the SP7 Cloudflare tunnel, AUTH_TRUSTED_IP_HEADER=cf-connecting-ip
  // makes the limiter genuinely per-client, so the code default of 10 is correct in production
  // (the SP6 LAN workaround value of 100 is retired). Default 10 also preserves dev/e2e
  // behaviour; the password-reset bucket stays fixed at 5/300 s.
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  // Optional. When set (production value: 'cf-connecting-ip'), better-auth reads ONLY this
  // header for the client IP (rate-limit key + session.ipAddress). CF-Connecting-IP is a single,
  // Cloudflare-set, unspoofable value, so per-client limiting works behind the tunnel with no
  // trustedProxies. Unset/blank ⇒ better-auth keeps its x-forwarded-for default (dev behaviour).
  // Consumed via trustedIpConfig() in src/lib/auth.ts.
  AUTH_TRUSTED_IP_HEADER: z.string().optional(),
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
