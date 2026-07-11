import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { saveUpload } from '@/lib/uploads'
import { assertCanMutate, PolicyError, policyStatus } from '@/features/issues/issue-policy'

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    assertCanMutate(user.role)
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
    const path = await saveUpload(file, 'issues')
    return NextResponse.json({ path, name: file.name, mime: file.type, size: file.size })
  } catch (e) {
    if (e instanceof PolicyError) return NextResponse.json({ error: e.message }, { status: policyStatus(e.code) })
    if (e instanceof Error && e.message === 'invalid_upload') return NextResponse.json({ error: 'invalid_upload' }, { status: 400 })
    throw e
  }
}
