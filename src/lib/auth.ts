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
          } else if ((await prisma.user.count()) === 1) {
            await prisma.user.update({ where: { id: user.id }, data: { role: 'admin' } })
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
