import { prisma } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { isMember } from '@/features/chat/conversation-service'
import { readUpload } from '@/lib/uploads'

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const isChat = path[0] === 'chat'

  // Chat attachments are chat reads of potentially confidential lab data, so
  // they go through the ConversationMember gate like every other chat read.
  // SP1's public assets (org logo, equipment images) must stay public — the
  // sign-in and equipment pages render them without a session.
  if (isChat) {
    const user = await getSessionUser()
    if (!user) return new Response('Unauthorized', { status: 401 })
    const publicPath = '/uploads/' + path.join('/')
    const attachment = await prisma.chatAttachment.findFirst({
      where: { path: publicPath },
      select: { message: { select: { conversationId: true } } },
    })
    if (!attachment) return new Response('Not found', { status: 404 })
    if (!(await isMember(user.id, attachment.message.conversationId))) return new Response('Forbidden', { status: 403 })
  }

  const file = await readUpload(path)
  if (!file) return new Response('Not found', { status: 404 })
  const headers: Record<string, string> = {
    'Content-Type': file.mime,
    // Chat files are private and must never be retained by shared/proxy caches;
    // public assets keep the long, shared cache they had in SP1.
    'Cache-Control': isChat ? 'private, no-store' : 'public, max-age=86400',
  }
  if (!file.mime.startsWith('image/')) {
    const name = path[path.length - 1] ?? 'download'
    headers['Content-Disposition'] = `attachment; filename="${name.replace(/[^a-zA-Z0-9._-]/g, '')}"`
  }
  return new Response(new Uint8Array(file.data), { headers })
}
