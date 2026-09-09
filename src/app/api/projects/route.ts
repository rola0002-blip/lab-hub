import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { listProjects, createProject } from '@/features/issues/project-service'
import { PolicyError } from '@/features/issues/issue-policy'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const projects = await listProjects()
  return NextResponse.json({ projects })
}

// Same shape the server action validates (createProjectSchema in issues/actions.ts):
// calendar dates, tri-state lead/folder ids. The service owns permission
// (assertCanMutate: guests 403), name/date rules and FK existence.
const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(4000).optional(),
  leadId: z.string().nullish(),
  documentFolderId: z.string().nullish(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELED']).optional(),
})

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = createBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const d = parsed.data
  try {
    const project = await createProject({
      actorId: user.id, role: user.role, name: d.name, description: d.description,
      leadId: d.leadId ?? null, documentFolderId: d.documentFolderId ?? null,
      startDate: d.startDate ? new Date(d.startDate) : null,
      targetDate: d.targetDate ? new Date(d.targetDate) : null, status: d.status,
    })
    return NextResponse.json({ project }, { status: 201 })
  } catch (e) {
    if (e instanceof PolicyError) {
      const status = e.code === 'forbidden' ? 403 : e.code === 'not_found' ? 404 : 422
      return NextResponse.json({ error: e.code }, { status })
    }
    throw e
  }
}
