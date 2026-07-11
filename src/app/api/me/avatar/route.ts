import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { saveUpload } from '@/lib/uploads'
import { setAvatar, removeAvatar } from '@/features/settings/service'

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  let path: string
  try {
    path = await saveUpload(file, 'avatars') // validates MIME (png/jpg/webp) + ≤5MB, generates a UUID name
  } catch {
    return NextResponse.json({ error: 'invalid_upload' }, { status: 400 })
  }
  await setAvatar(user.id, path)
  return NextResponse.json({ ok: true, image: path })
}

export async function DELETE() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await removeAvatar(user.id)
  return NextResponse.json({ ok: true })
}
