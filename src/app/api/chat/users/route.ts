import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSessionUser } from '@/lib/session'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  // Include system users (the LabHub bot) WITH an isSystem flag so DM name
  // resolution (dmName / DM header / conversation list) works — a bot DM must not
  // render as "unknown". Human-facing choosers (mention autocomplete, new-DM /
  // add-people pickers) filter isSystem out client-side via `humanUsers`, keeping
  // the bot invisible there. The People page stays server-filtered separately.
  const users = await prisma.user.findMany({
    where: { banned: false }, select: { id: true, name: true, role: true, image: true, isSystem: true }, orderBy: { name: 'asc' },
  })
  return NextResponse.json({ users })
}
