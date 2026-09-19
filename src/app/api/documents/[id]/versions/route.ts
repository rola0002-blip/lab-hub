import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { saveUpload, removeUpload } from '@/lib/uploads'
import { assertCanUpload, PolicyError, policyStatus } from '@/features/documents/documents-policy'
import { uploadNewVersion } from '@/features/documents/version-service'

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
