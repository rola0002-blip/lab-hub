import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { admin } from 'better-auth/plugins'
import { nextCookies } from 'better-auth/next-js'
import { APIError } from 'better-auth/api'
import { hash, verify } from '@node-rs/argon2'
import { prisma } from './db'
import { env } from './env'
import { enqueueEmail } from './email/outbox'
import { resetPasswordEmail } from './email/templates'
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
          if (!(await isSetupComplete())) return // first-admin bootstrap via setup wizard
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
  rateLimit: {
    enabled: true,
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/sign-up/email': { window: 60, max: 10 },
      '/request-password-reset': { window: 300, max: 5 },
    },
  },
  plugins: [admin({ adminRoles: ['admin'], defaultRole: 'guest' }), nextCookies()],
})
