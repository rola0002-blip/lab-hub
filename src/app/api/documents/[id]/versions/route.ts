import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { getOrg } from '@/lib/org'
import { formatDateTime } from '@/lib/time'
import { saveUpload, removeUpload } from '@/lib/uploads'
import { assertCanUpload, PolicyError, policyStatus } from '@/features/documents/documents-policy'
import { listVersions, uploadNewVersion } from '@/features/documents/version-service'

// History read for the Files version drawer. Browse = any authenticated user
// (guests included — the listing/download posture), so there is no role gate
// beyond the session. The wire shape is built explicitly: VersionDto + `path`
// (each version's bytes serve through the normal uploads gate) with `created`
// formatted SERVER-side in the org timezone — the formatDateTime idiom, never
// the browser's ambient zone.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const org = await getOrg()
  const tz = org?.timezone ?? 'Asia/Singapore'
  const versions = await listVersions(id)
  return NextResponse.json({ versions: versions.map((v) => ({ id: v.id, version: v.version, name: v.name, mime: v.mime, size: v.size, path: v.path, uploadedByName: v.uploadedByName, created: formatDateTime(v.createdAt, tz) })) })
}

// Multipart one-shot: save the office file + register it as the file's NEXT
// version. Mirrors api/documents/route.ts exactly — session gate, guest 403
// (assertCanUpload), 100 MB / type cap inside saveUpload, unlink-on-failure so
// a rejected version upload is not orphaned on the volume. The path is
// SERVER-minted by saveUpload (uploadNewVersion re-asserts the
// /uploads/documents/ prefix); the document id rides the URL.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    assertCanUpload(user.role)
    const { id } = await params
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
    const path = await saveUpload(file, 'documents') // throws invalid_upload for bad type / >100 MB / 0 byte
    try {
      const dto = await uploadNewVersion({ documentId: id, uploaderId: user.id, role: user.role, name: file.name, path, mime: file.type, size: file.size })
      return NextResponse.json(dto, { status: 201 })
    } catch (err) {
      await removeUpload(path).catch(() => {})
      throw err
    }
  } catch (e) {
    if (e instanceof PolicyError) return NextResponse.json({ error: e.message }, { status: policyStatus(e.code) })
    if (e instanceof Error && e.message === 'invalid_upload') return NextResponse.json({ error: 'invalid_upload', message: 'Allowed: images, PDF, Office, txt/csv, zip — max 100 MB.' }, { status: 400 })
    throw e
  }
}
