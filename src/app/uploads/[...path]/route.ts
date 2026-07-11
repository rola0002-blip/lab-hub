import { prisma } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { isMember } from '@/features/chat/conversation-service'
import { readUpload } from '@/lib/uploads'

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params

  // Path-traversal guard — must run BEFORE the isChat gate and readUpload.
  // The gate below decides "is this a chat read?" from path[0], but readUpload
  // sanitises each segment (stripping chars outside [A-Za-z0-9._-]) and then
  // path.join()s them, which collapses '.'/'..' and drops empty segments. Those
  // two views disagree: a request like ['logo','..','chat',<uuid>] has
  // path[0] === 'logo' (gate skipped) yet resolves into chat/, leaking a
  // confidential attachment with a public cache header. Reject any segment that
  // is empty, '.'/'..', or that the sanitiser would rewrite, so path[0]
  // provably names the same top-level dir readUpload will open — no arrangement
  // can resolve into chat/ while evading the session+membership check.
  const sanitize = (seg: string) => seg.replace(/[^a-zA-Z0-9._-]/g, '')
  if (path.some((seg) => seg === '' || seg === '.' || seg === '..' || sanitize(seg) !== seg)) {
    return new Response('Not found', { status: 404 })
  }

  const isChat = path[0].toLowerCase() === 'chat'
  const isAvatar = path[0].toLowerCase() === 'avatars'
  const isPrivate = isChat || isAvatar

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
  } else if (isAvatar) {
    // Avatars are user photos: any authenticated session may read them, but they
    // are not public. The traversal/case-fold guard above already proved path[0]
    // names the same top-level dir readUpload will open, so no request can evade
    // this gate by resolving into avatars/ from another prefix.
    const user = await getSessionUser()
    if (!user) return new Response('Unauthorized', { status: 401 })
  }

  const file = await readUpload(path)
  if (!file) return new Response('Not found', { status: 404 })
  const headers: Record<string, string> = {
    'Content-Type': file.mime,
    // Chat files and avatars are private and must never be retained by
    // shared/proxy caches; SP1 public assets keep the long, shared cache.
    'Cache-Control': isPrivate ? 'private, no-store' : 'public, max-age=86400',
  }
  if (!file.mime.startsWith('image/')) {
    const name = path[path.length - 1] ?? 'download'
    headers['Content-Disposition'] = `attachment; filename="${name.replace(/[^a-zA-Z0-9._-]/g, '')}"`
  }
  return new Response(new Uint8Array(file.data), { headers })
}
