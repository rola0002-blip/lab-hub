import { getSessionUser } from '@/lib/session'
import { subscribe, type LabEvent } from '@/lib/events'
import { accessibleConversationIds } from '@/features/chat/conversation-service'

// NOTE: Task 4 creates accessibleConversationIds. Until Task 4 lands, this
// route is committed with the import above and the build will fail if Task 4
// is skipped — the plan runs Task 4 immediately after; do not reorder.

export async function GET(req: Request) {
  const user = await getSessionUser()
  if (!user) return new Response('unauthorized', { status: 401 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: LabEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`))
      const load = async () => new Set(await accessibleConversationIds(user.id))
      const unsubscribe = subscribe({ userId: user.id, conversationIds: await load(), reload: load, send })
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(': hb\n\n')) } catch { /* closing */ }
      }, 25_000)
      const close = () => {
        clearInterval(heartbeat)
        unsubscribe()
        try { controller.close() } catch { /* already closed */ }
      }
      req.signal.addEventListener('abort', close)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
