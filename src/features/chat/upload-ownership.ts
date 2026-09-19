import 'server-only'
import { prisma } from '@/lib/db'

/** Record that `userId` minted `path` (called by the chat attachment upload route). */
export async function recordChatUpload(path: string, userId: string): Promise<void> {
  await prisma.chatUpload.create({ data: { path, userId } }).catch(() => {
    /* path re-recorded (retry) — the unique row already proves ownership */
  })
}
