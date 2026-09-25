import { getSessionUser } from '@/lib/session'
import { buildDocumentsZip } from '@/features/documents/export-service'

// Bulk download of ticked Files rows as a zip. Read posture: ANY authenticated
// role incl. guests (the versions-GET / uploads-serving precedent). Every denial
// carries `private, no-store` — the wave-13 CDN-404-poison doctrine (never return
// a bare error Response on a download route).
const deny = (status: number, body: string) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' } })

export async function GET(req: Request) {
  const user = await getSessionUser()
  if (!user) return deny(401, 'Unauthorized')
  const raw = new URL(req.url).searchParams.get('ids') ?? ''
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) return deny(400, 'No file ids given.')
  if (ids.length > 100) return deny(400, 'Too many files selected (max 100).')
  let exported: Awaited<ReturnType<typeof buildDocumentsZip>>
  try { exported = await buildDocumentsZip(ids) }
  catch { return deny(500, 'Export failed.') }
  if (!exported) return deny(404, 'Not found')
  if ('tooLarge' in exported) return deny(413, 'Export too large (max 1 GB) — select fewer files.')
  return new Response(new Uint8Array(exported.body), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${exported.filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
