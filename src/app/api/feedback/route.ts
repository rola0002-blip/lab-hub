import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { saveUpload, removeUpload } from '@/lib/uploads'
import { PolicyError, policyStatus } from '@/features/feedback/feedback-policy'
import { submitFeedback } from '@/features/feedback/feedback-service'
import { APP_VERSION } from '@/lib/version'

// One-shot multipart submit, contract per POST /api/documents (spec §7.2): save the
// screenshot, then create the row, and unlink the file on ANY failure after the save.
// The service is deliberately runtime-guardless on `type` — THIS schema is the guard,
// so an unknown enum member can never reach the Prisma insert. Zod lives at the route
// layer, never in the service.
const fields = z.object({
  type: z.enum(['BUG', 'IDEA']),
  // Non-empty only types the field; POST-TRIM emptiness is the service's
  // PolicyError('invalid'), which is why the throw-after-upload arm below exists.
  body: z.string().min(1).max(4000),
  pagePath: z.string(),
})

// appVersion and userAgent are stamped by the SERVER below and never read from the
// body — a client that posts its own is ignored. The service re-slices to the same
// bound; capping here keeps an absurd header out of the service call entirely.
const UA_MAX = 300

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  // Hoisted so both failure arms (the rate_limited RETURN and the catch) can unlink
  // the file the request had already written.
  let screenshotPath: string | null = null
  try {
    // A non-multipart body makes formData() throw; swallow it into the same
    // bad_request as a zod miss rather than a 500 (the chat route's `req.json()
    // .catch(() => null)` idiom — this endpoint is internet-facing).
    const form = await req.formData().catch(() => null)
    if (!form) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
    const parsed = fields.safeParse({ type: form.get('type'), body: form.get('body'), pagePath: form.get('pagePath') })
    if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

    const file = form.get('screenshot')
    // A zero-byte entry is an EMPTY file input, not a screenshot: validateUpload would
    // reject it anyway, so treat it as "no screenshot" rather than a confusing 400.
    if (file instanceof File && file.size > 0) {
      screenshotPath = await saveUpload(file, 'feedback') // throws invalid_upload: non-image or >10 MB
    }

    const result = await submitFeedback(user, {
      ...parsed.data,
      screenshotPath,
      appVersion: APP_VERSION,
      userAgent: (req.headers.get('user-agent') ?? '').slice(0, UA_MAX),
    })
    if (!result.ok) {
      // The limiter's arm of the service's HYBRID contract is a return, not a throw, so
      // it needs its own cleanup: rate-limited means nothing persisted (spec §10), and
      // without this every throttled submit would leak up to 10 MB to the volume.
      if (screenshotPath) await removeUpload(screenshotPath).catch(() => {})
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
    }
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (e) {
    // The file is already written; if the service throws (whitespace-only body, a
    // screenshot path outside /uploads/feedback/) unlink it so the upload is not
    // orphaned on the volume — the documents-route idiom. removeUpload is best-effort
    // and swallowed so the ORIGINAL error still maps to a clean status.
    if (screenshotPath) await removeUpload(screenshotPath).catch(() => {})
    if (e instanceof PolicyError) return NextResponse.json({ error: e.message }, { status: policyStatus(e.code) })
    if (e instanceof Error && e.message === 'invalid_upload') {
      return NextResponse.json({ error: 'invalid_upload', message: 'Screenshots: PNG, JPEG or WebP — max 10 MB.' }, { status: 400 })
    }
    throw e
  }
}
