import { prisma } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { isMember } from '@/features/chat/conversation-service'
import { readUpload, contentDisposition } from '@/lib/uploads'

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
  const isIssue = path[0].toLowerCase() === 'issues'
  const isDocument = path[0].toLowerCase() === 'documents'
  const isFeedback = path[0].toLowerCase() === 'feedback'
  const isPrivate = isChat || isAvatar || isIssue || isDocument || isFeedback

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
  } else if (isAvatar || isIssue || isDocument || isFeedback) {
    // Avatars, issue attachments, shared documents AND feedback screenshots are
    // private but workspace-visible: any authenticated session (incl. guests) may
    // read them. The traversal/case-fold guard above already proved path[0] names
    // the same top-level dir readUpload will open. A new kind is served PUBLICLY,
    // with a shared-cache header, until this arm learns it — feedback screenshots
    // can show lab data, so the kind must never fall through (spec §7.1).
    const user = await getSessionUser()
    if (!user) return new Response('Unauthorized', { status: 401 })
  }

  const file = await readUpload(path)
  if (!file) return new Response('Not found', { status: 404 })
  const headers: Record<string, string> = {
    'Content-Type': file.mime,
    // Chat files, avatars, documents and feedback screenshots are private and must
    // never be retained by shared/proxy caches; SP1 public assets keep the long,
    // shared cache.
    'Cache-Control': isPrivate ? 'private, no-store' : 'public, max-age=86400',
    // Attacker-supplied bytes are served inline (pdf/image), so never let a browser
    // MIME-sniff them into an executable type. Belt-and-suspenders alongside the global
    // next.config nosniff header, since this Route Handler builds its own Response (SP7 §7.1).
    'X-Content-Type-Options': 'nosniff',
  }
  if (isDocument) {
    // Recover the human filename (on-disk basename is a UUID) and 404 unknown paths.
    const doc = await prisma.document.findFirst({ where: { path: '/uploads/' + path.join('/') }, select: { name: true } })
    if (!doc) return new Response('Not found', { status: 404 })
    // pdf + images view inline in a new tab; office files download. Either way the
    // original name survives via filename* (RFC 5987).
    const inline = file.mime === 'application/pdf' || file.mime.startsWith('image/')
    headers['Content-Disposition'] = contentDisposition(inline ? 'inline' : 'attachment', doc.name)
  } else if (!file.mime.startsWith('image/')) {
    // Chat/issue/avatar non-image downloads keep the UUID basename, but stop mangling —
    // the shared builder star-encodes it (harmless for an ASCII UUID).
    const name = path[path.length - 1] ?? 'download'
    headers['Content-Disposition'] = contentDisposition('attachment', name)
  }
  return new Response(new Uint8Array(file.data), { headers })
}
