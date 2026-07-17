import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { admin } from 'better-auth/plugins'
import { nextCookies } from 'better-auth/next-js'
import { APIError } from 'better-auth/api'
import { hash, verify } from '@node-rs/argon2'
import { prisma } from './db'
import { env } from './env'
import { authRateLimitRules } from './auth-rate-limit'
import { trustedIpConfig } from './auth-ip'
import { enqueueEmail } from './email/outbox'
import { resetPasswordEmail } from './email/templates'
import { setupTokenConfigured, inAuthorizedBootstrap } from './setup-token'
import { LAB_UPDATES_CHANNEL_ID } from '@/features/bot'

async function isSetupComplete() {
  const org = await prisma.organization.findFirst()
  return !!org?.setupComplete
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.APP_URL,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    password: {
      hash: (password) => hash(password),
      verify: ({ hash: h, password }) => verify(h, password),
    },
    sendResetPassword: async ({ user, url }) => {
      const org = await prisma.organization.findFirst()
      const t = resetPasswordEmail(org?.name ?? 'COLOSSUS', url)
      await enqueueEmail(user.email, t.subject, t.html)
    },
  },
  // user.role is provided by the admin plugin (never client-settable);
  // the after-hook below copies the invited role onto the user row.
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (!(await isSetupComplete())) {
            // First-admin bootstrap window. When a SETUP_TOKEN gate is configured, the ONLY
            // legitimate sign-up here is the one completeSetup() authorizes AFTER validating
            // the token (it wraps its internal admin sign-up in runAuthorizedBootstrap). Reject
            // any other, direct/un-invited sign-up so an internet party cannot claim the
            // first-admin slot over the public tunnel before provisioning finishes (SP7 F1).
            // Gate unset ⇒ today's behaviour (dev/local + existing deployments unaffected).
            if (setupTokenConfigured() && !inAuthorizedBootstrap())
              throw new APIError('FORBIDDEN', {
                message: 'Setup is protected. Complete provisioning through the setup wizard with the setup token.',
              })
            return
          }
          const inv = await prisma.invitation.findFirst({
            where: { email: user.email.toLowerCase(), status: 'PENDING', expiresAt: { gt: new Date() } },
          })
          if (!inv)
            throw new APIError('FORBIDDEN', {
              message: 'Sign-up is by invitation only. Ask an administrator for an invite.',
            })
        },
        after: async (user) => {
          const inv = await prisma.invitation.findFirst({
            where: { email: user.email.toLowerCase(), status: 'PENDING', expiresAt: { gt: new Date() } },
          })
          if (inv) {
            await prisma.invitation.update({ where: { id: inv.id }, data: { status: 'ACCEPTED' } })
            await prisma.user.update({ where: { id: user.id }, data: { role: inv.role } })
          } else if ((await prisma.user.count({ where: { isSystem: false } })) === 1) {
            // Scope the first-admin bootstrap to non-system users: a pre-seeded bot
            // (created by a migration at deploy, before setup) must never consume the
            // first-admin slot under any ordering.
            await prisma.user.update({ where: { id: user.id }, data: { role: 'admin' } })
          }
          // Auto-join every new human account to #lab-updates. Best-effort + idempotent:
          // this is the single choke point through which the setup admin and every
          // invitation acceptance is created. Non-fatal — a missing channel (e.g. a
          // test DB whose seed was truncated) must never break sign-up.
          try {
            await prisma.conversationMember.upsert({
              where: { conversationId_userId: { conversationId: LAB_UPDATES_CHANNEL_ID, userId: user.id } },
              update: {},
              create: { conversationId: LAB_UPDATES_CHANNEL_ID, userId: user.id },
            })
          } catch (e) {
            console.error('lab-updates auto-join failed', e)
          }
        },
      },
    },
  },
  // Client-IP source for rate-limit keying + session.ipAddress. Behind the SP7 Cloudflare
  // tunnel, AUTH_TRUSTED_IP_HEADER=cf-connecting-ip makes better-auth read the single,
  // Cloudflare-set, unspoofable CF-Connecting-IP header — restoring genuine per-client
  // sign-in/up limiting with no trustedProxies. Unset (dev) ⇒ undefined ⇒ x-forwarded-for
  // default. See src/lib/auth-ip.ts.
  advanced: trustedIpConfig(env.AUTH_TRUSTED_IP_HEADER),
  rateLimit: {
    enabled: true,
    // Per-endpoint sign-in/up ceiling from AUTH_RATE_LIMIT_MAX (default 10). With per-client
    // IP keying restored by `advanced` above, 10/60 s is a real per-client limit behind the
    // tunnel; password reset stays fixed at 5/300 s (see ./auth-rate-limit).
    customRules: authRateLimitRules(env.AUTH_RATE_LIMIT_MAX),
  },
  plugins: [admin({ adminRoles: ['admin'], defaultRole: 'guest' }), nextCookies()],
})
