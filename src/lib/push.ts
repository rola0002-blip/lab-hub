import 'server-only'
import webpush from 'web-push'
import { prisma } from './db'
import { env } from './env'

export function pushEnabled(): boolean {
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)
}

export type PushSender = (endpoint: string, p256dh: string, auth: string, payload: string) => Promise<void>

let configured = false
function defaultSender(): PushSender | null {
  if (!pushEnabled()) return null
  if (!configured) {
    webpush.setVapidDetails('mailto:admin@labhub.local', env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)
    configured = true
  }
  return (endpoint, p256dh, auth, payload) =>
    webpush.sendNotification({ endpoint, keys: { p256dh, auth } }, payload).then(() => undefined)
}

export async function saveSubscription(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<void> {
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  })
}

export async function deleteSubscription(userId: string, endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } })
}

export async function sendPush(
  userId: string,
  payload: { title: string; body: string; url: string; tag?: string },
  sender?: PushSender,
): Promise<void> {
  try {
    const send = sender ?? defaultSender()
    if (!send) return // push disabled and no injected sender
    const subs = await prisma.pushSubscription.findMany({ where: { userId } })
    const json = JSON.stringify(payload)
    for (const s of subs) {
      try {
        await send(s.endpoint, s.p256dh, s.auth, json)
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {})
      }
    }
  } catch (e) {
    console.error('sendPush failed', e) // push must never break the caller
  }
}
