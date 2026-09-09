import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { listActiveEquipment } from '@/features/equipment/service'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const equipment = await listActiveEquipment()
  return NextResponse.json({ equipment })
}
