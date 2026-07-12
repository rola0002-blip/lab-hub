import 'server-only'
import { Client } from 'pg'
import type { IssueStatus } from '@prisma/client'
import { prisma } from './db'
import { env } from './env'

export type LabEvent =
  | { t: 'msg' | 'msg_edit' | 'msg_del' | 'rx'; cid: string; mid: string }
  | { t: 'typing'; cid: string; uid: string; name: string }
  | { t: 'presence'; uid: string; online: boolean }
  | { t: 'notif'; uid: string }
  | { t: 'read'; cid: string; uid: string }
  | { t: 'member'; cid: string; uid: string }
  // SP4: issues are workspace-visible, so these broadcast to ALL subscribers with
  // NO membership filter (deliberately unlike chat events — do not copy this into
  // chat routing). `issue` = created/updated; `issue_move` = board move; `issue_comment` = a comment landed.
  | { t: 'issue'; id: string; projectId?: string }
  | { t: 'issue_move'; id: string; status: IssueStatus; rank: string }
  | { t: 'issue_comment'; issueId: string }

export type Subscriber = {
  userId: string
  conversationIds: Set<string>
  reload: () => Promise<Set<string>>
  send: (e: LabEvent) => void
}

const CHANNEL = 'labhub_events'

// globalThis guards survive dev HMR module reloads (same pattern as db.ts).
const g = globalThis as unknown as {
  labhubSubs?: Map<number, Subscriber>
  labhubListener?: Client | null
  labhubListenerStarting?: boolean
  labhubNextSubId?: number
}
g.labhubSubs ??= new Map()
g.labhubNextSubId ??= 1

export async function emitEvent(e: LabEvent): Promise<void> {
  try {
    await prisma.$executeRaw`SELECT pg_notify(${CHANNEL}, ${JSON.stringify(e)})`
  } catch (err) {
    console.error('emitEvent failed', err) // delivery is best-effort; data is already persisted
  }
}

async function dispatch(e: LabEvent): Promise<void> {
  if (e.t === 'member') {
    for (const sub of g.labhubSubs!.values()) {
      if (sub.userId === e.uid) {
        try { sub.conversationIds = await sub.reload() } catch { /* keep old set */ }
      }
    }
  }
  for (const sub of g.labhubSubs!.values()) {
    const deliver =
      e.t === 'presence' ? true
      : e.t === 'notif' ? sub.userId === e.uid
      : e.t === 'read' ? sub.userId === e.uid && sub.conversationIds.has(e.cid)
      : e.t === 'typing' ? sub.userId !== e.uid && sub.conversationIds.has(e.cid)
      : e.t === 'member' ? sub.userId === e.uid || sub.conversationIds.has(e.cid)
      : e.t === 'issue' || e.t === 'issue_move' || e.t === 'issue_comment' ? true // workspace-wide, no membership filter
      : sub.conversationIds.has(e.cid) // msg / msg_edit / msg_del / rx
    if (deliver) {
      try { sub.send(e) } catch { /* dead subscriber; unsubscribe cleans up */ }
    }
  }
}

async function startListener(): Promise<void> {
  if (g.labhubListener || g.labhubListenerStarting) return
  g.labhubListenerStarting = true
  try {
    const client = new Client({ connectionString: env.DATABASE_URL })
    client.on('notification', (n) => {
      if (n.channel !== CHANNEL || !n.payload) return
      try { void dispatch(JSON.parse(n.payload) as LabEvent) } catch { /* malformed payload ignored */ }
    })
    client.on('error', () => scheduleReconnect())
    client.on('end', () => scheduleReconnect())
    await client.connect()
    await client.query(`LISTEN ${CHANNEL}`)
    g.labhubListener = client
  } catch (err) {
    console.error('LISTEN connect failed', err)
    scheduleReconnect()
  } finally {
    g.labhubListenerStarting = false
  }
}

let reconnectTimer: ReturnType<typeof setTimeout> | null = null
function scheduleReconnect(): void {
  g.labhubListener = null
  if (reconnectTimer || g.labhubSubs!.size === 0) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void startListener()
  }, 2_000)
}

// Presence is delivered in-process, synchronously — NOT over pg NOTIFY. A single
// Next.js instance shares this module's subscriber registry across every SSE
// connection, so a local broadcast already reaches every tab/user on the box.
// Routing over pg would break the presence contract two ways: (a) the `online`
// frame is emitted before the shared LISTEN client finishes connecting, so
// Postgres drops it (it does not queue NOTIFYs for backends that start listening
// later); (b) the `offline` frame would be an async round-trip, so a caller that
// unsubscribes and immediately reads state (as the test does) never sees it. The
// routing rule stays "presence -> everyone" (mirrored in dispatch()).
function broadcastPresence(uid: string, online: boolean): void {
  for (const sub of g.labhubSubs!.values()) {
    try { sub.send({ t: 'presence', uid, online }) } catch { /* dead subscriber; unsubscribe cleans up */ }
  }
}

export function subscribe(sub: Subscriber): () => void {
  const id = g.labhubNextSubId!++
  const firstForUser = !hasLiveConnection(sub.userId)
  // Snapshot who is already online for the newcomer — the prior `online`
  // broadcasts predate this subscriber and would otherwise be invisible to it.
  for (const uid of onlineUserIds()) sub.send({ t: 'presence', uid, online: true })
  g.labhubSubs!.set(id, sub)
  void startListener()
  if (firstForUser) broadcastPresence(sub.userId, true) // first tab -> user came online
  return () => {
    g.labhubSubs!.delete(id)
    if (!hasLiveConnection(sub.userId)) broadcastPresence(sub.userId, false) // last tab -> offline
  }
}

export function hasLiveConnection(userId: string): boolean {
  for (const sub of g.labhubSubs!.values()) if (sub.userId === userId) return true
  return false
}

export function onlineUserIds(): string[] {
  return [...new Set([...g.labhubSubs!.values()].map((s) => s.userId))]
}

export async function _resetForTests(): Promise<void> {
  g.labhubSubs!.clear()
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  if (g.labhubListener) { await g.labhubListener.end().catch(() => {}) ; g.labhubListener = null }
}
