import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSessionUser } from '@/lib/session'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const users = await prisma.user.findMany({
    where: { banned: false }, select: { id: true, name: true, role: true, image: true }, orderBy: { name: 'asc' },
  })
  return NextResponse.json({ users })
}
