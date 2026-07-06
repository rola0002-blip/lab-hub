import 'server-only'
import nodemailer from 'nodemailer'
import { prisma } from '@/lib/db'
import { env } from '@/lib/env'

export type SendFn = (msg: { to: string; subject: string; html: string }) => Promise<void>

export async function enqueueEmail(toEmail: string, subject: string, html: string): Promise<void> {
  await prisma.emailOutbox.create({ data: { toEmail, subject, html } })
}

let transport: nodemailer.Transporter | null = null
function defaultSend(): SendFn | null {
  if (!env.SMTP_HOST) return null
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  })
  return async ({ to, subject, html }) => { await transport!.sendMail({ from: env.SMTP_FROM, to, subject, html }) }
}

const MAX_ATTEMPTS = 8

export async function drainOutbox(send?: SendFn): Promise<number> {
  const doSend = send ?? defaultSend()
  if (!doSend) return 0
  const due = await prisma.emailOutbox.findMany({
    where: { status: 'QUEUED', nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: 'asc' }, take: 20,
  })
  let sent = 0
  for (const m of due) {
    try {
      await doSend({ to: m.toEmail, subject: m.subject, html: m.html })
      await prisma.emailOutbox.update({ where: { id: m.id }, data: { status: 'SENT', sentAt: new Date() } })
      sent++
    } catch (e) {
      const attempts = m.attempts + 1
      await prisma.emailOutbox.update({
        where: { id: m.id },
        data: {
          attempts,
          status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'QUEUED',
          lastError: String(e).slice(0, 500),
          nextAttemptAt: new Date(Date.now() + Math.min(2 ** attempts, 60) * 60_000),
        },
      })
    }
  }
  return sent
}
