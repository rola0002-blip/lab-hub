import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { saveUpload } from '@/lib/uploads'

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  try {
    const path = await saveUpload(file, 'chat')
    return NextResponse.json({ path, name: file.name, mime: file.type, size: file.size }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'invalid_upload', message: 'Allowed: images, PDF, Office, txt/csv, zip — max 25 MB.' }, { status: 422 })
  }
}
