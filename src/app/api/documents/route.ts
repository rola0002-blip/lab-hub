import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { saveUpload, removeUpload } from '@/lib/uploads'
import { assertCanUpload, PolicyError, policyStatus } from '@/features/documents/documents-policy'
import { createDocument } from '@/features/documents/document-service'

// Multipart one-shot: save the office file + create the Document row in one request.
// Guests → 403 (assertCanUpload). The path is SERVER-minted by saveUpload — no client
// path is trusted (createDocument re-asserts the /uploads/documents/ prefix).
export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    assertCanUpload(user.role)
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
    const folderId = (form.get('folderId') as string) || null
    const nameField = form.get('name')
    const name = typeof nameField === 'string' && nameField ? nameField : file.name
    const path = await saveUpload(file, 'documents') // throws invalid_upload for bad type / >100 MB / 0 byte
    try {
      const dto = await createDocument({ uploaderId: user.id, uploaderName: user.name, name, path, mime: file.type, size: file.size, folderId })
      return NextResponse.json(dto, { status: 201 })
    } catch (err) {
      // The file is already written; if createDocument throws (e.g. a stale/absent
      // folderId → PolicyError('invalid')) unlink it so the upload is not orphaned on
      // the volume — spec §6.5 validates the folder before the file lands. removeUpload
      // is best-effort and swallowed so the ORIGINAL error still maps to a clean 400.
      await removeUpload(path).catch(() => {})
      throw err
    }
  } catch (e) {
    if (e instanceof PolicyError) return NextResponse.json({ error: e.message }, { status: policyStatus(e.code) })
    if (e instanceof Error && e.message === 'invalid_upload') return NextResponse.json({ error: 'invalid_upload', message: 'Allowed: images, PDF, Office, txt/csv, zip — max 100 MB.' }, { status: 400 })
    throw e
  }
}
