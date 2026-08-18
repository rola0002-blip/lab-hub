import 'server-only'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const IMAGE_ALLOWED: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }
const CHAT_ALLOWED: Record<string, string> = {
  ...IMAGE_ALLOWED,
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/zip': '.zip',
}
const IMAGE_MAX = 2 * 1024 * 1024
const CHAT_MAX = 25 * 1024 * 1024
const AVATAR_MAX = 5 * 1024 * 1024
const DOCUMENT_MAX = 100 * 1024 * 1024 // shared library files; office allowlist, big cap
const FEEDBACK_MAX = 10 * 1024 * 1024  // phone PNG screenshots overflow IMAGE_MAX; 25 MB headroom is unneeded

export type UploadKind = 'logo' | 'equipment' | 'chat' | 'avatars' | 'issues' | 'documents' | 'feedback' | 'project-updates'

// Doc-kind uploads (chat + issue + project-update attachments) share the 25 MB
// cap + the wider document MIME allowlist; image kinds (logo/equipment/avatars)
// stay image-only. 'documents' shares the same office allowlist but takes the
// 100 MB cap. 'feedback' is image-only (IMAGE_ALLOWED, by fall-through) with
// its OWN 10 MB cap.
const DOC_KINDS = new Set<UploadKind>(['chat', 'issues', 'project-updates'])

export function uploadsDir() {
  return path.resolve(process.env.UPLOADS_DIR ?? './data/uploads')
}

export function validateUpload(mime: string, size: number, kind: UploadKind = 'logo'): string {
  const table = kind === 'documents' || DOC_KINDS.has(kind) ? CHAT_ALLOWED : IMAGE_ALLOWED
  const max = kind === 'documents' ? DOCUMENT_MAX : DOC_KINDS.has(kind) ? CHAT_MAX : kind === 'avatars' ? AVATAR_MAX : kind === 'feedback' ? FEEDBACK_MAX : IMAGE_MAX
  const ext = table[mime]
  if (!ext || size > max || size === 0) throw new Error('invalid_upload')
  return ext
}

export async function saveUpload(file: File, kind: UploadKind): Promise<string> {
  const ext = validateUpload(file.type, file.size, kind)
  const name = `${randomUUID()}${ext}`
  const dir = path.join(uploadsDir(), kind)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()))
  return `/uploads/${kind}/${name}`
}

export async function readUpload(relPath: string[]): Promise<{ data: Buffer; mime: string } | null> {
  const safe = relPath.map((p) => p.replace(/[^a-zA-Z0-9._-]/g, ''))
  const full = path.join(uploadsDir(), ...safe)
  if (!full.startsWith(uploadsDir())) return null
  const ext = path.extname(full)
  // Resolve against the CHAT_ALLOWED superset so document attachments (pdf,
  // office, txt/csv, zip) serve with their real mime, not just images.
  const mime = Object.entries(CHAT_ALLOWED).find(([, e]) => e === ext)?.[0] ?? (ext === '.jpg' ? 'image/jpeg' : null)
  if (!mime) return null
  try { return { data: await readFile(full), mime } } catch { return null }
}

// Delete a previously saved file by its stored public path (e.g. a
// ChatAttachment.path like '/uploads/chat/<uuid>.pdf'). Sanitised and confined
// to uploadsDir() exactly like readUpload, so a crafted path can never unlink
// outside the uploads tree. Best-effort: a missing file is not an error.
export async function removeUpload(publicPath: string): Promise<void> {
  const rel = publicPath.replace(/^\/uploads\//, '').split('/').map((p) => p.replace(/[^a-zA-Z0-9._-]/g, ''))
  const full = path.join(uploadsDir(), ...rel)
  if (!full.startsWith(uploadsDir())) return
  await rm(full, { force: true })
}

// Build a Content-Disposition that survives a non-ASCII filename (RFC 5987/6266):
// an ASCII-only `filename="…"` fallback PLUS `filename*=UTF-8''<pct-encoded>`. Because
// document on-disk basenames are UUIDs, serving Document.name is what makes a non-ASCII
// name reachable, and the star-encoding is what lets it survive the download. Replaces
// the old lossy `.replace(/[^a-zA-Z0-9._-]/g, '')` mangle on the uploads route.
export function contentDisposition(disposition: 'inline' | 'attachment', filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  // encodeURIComponent leaves !'()* unescaped; RFC 5987 attr-char excludes them, so
  // percent-encode those too for a strictly valid ext-value.
  const star = encodeURIComponent(filename).replace(/['()*!]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${star}`
}
