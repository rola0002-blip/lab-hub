import { NextResponse } from 'next/server'
import { APP_VERSION } from '@/lib/version'

// Minimal, UNAUTHENTICATED liveness + version probe. update.ps1 polls this after a
// patch and compares `version` to the target tag (spec §3.4). Returns ONLY
// { ok, version } — no session, no DB, no org/user/env/SMTP/VAPID data — safe on the
// LAN. force-dynamic so it always reflects the running image, never a cached body.
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({ ok: true, version: APP_VERSION })
}
