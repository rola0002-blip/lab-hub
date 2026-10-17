import { getSessionUser } from '@/lib/session'
import { getOrg } from '@/lib/org'
import { canReviewRa } from '@/features/ra/ra-policy'
import { listAllRaAcknowledgments } from '@/features/ra/ra-service'
import { buildRaAcknowledgmentsXlsx, raExportFilename, RA_EXPORT_MIME } from '@/features/ra/export'
import { orgToday } from '@/features/issues/due'

// W21-B: admin-only RA records workbook (replaces the v0.23 CSV route). Session-
// gated, 404-as-deny so the existence of records never leaks to non-admins (the
// /api/bookings/[id]/ics posture). EVERY response carries `private, no-store` —
// denials and the 500 path included: Cloudflare error-caches extension-mapped
// URLs and Next's default error response carries no Cache-Control (the wave-13 /
// wave-18 download-route doctrine).
const deny = (status: number, body: string) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' } })

export async function GET() {
  let body: Buffer
  let filename: string
  try {
    // The session lookup sits inside the try too: an auth/DB failure must still
    // answer with a no-store deny, never Next's bare default 500.
    const user = await getSessionUser()
    if (!user || !canReviewRa(user.role)) return deny(404, 'Not found')
    const timezone = (await getOrg())?.timezone ?? 'Asia/Singapore'
    body = await buildRaAcknowledgmentsXlsx(await listAllRaAcknowledgments(user), timezone)
    filename = raExportFilename(orgToday(new Date(), timezone))
  } catch {
    return deny(500, 'Export failed.')
  }
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type': RA_EXPORT_MIME,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
