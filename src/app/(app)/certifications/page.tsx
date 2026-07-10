import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import Matrix from './matrix'

export default async function CertificationsPage() {
  const me = await requireUser()
  if (me.role === 'guest') redirect('/dashboard')
  const [users, equipment, certs, myManaged] = await Promise.all([
    prisma.user.findMany({ where: { banned: false }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } }),
    prisma.equipment.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.certification.findMany({ select: { userId: true, equipmentId: true } }),
    prisma.equipmentManager.findMany({ where: { userId: me.id }, select: { equipmentId: true } }),
  ])
  const editable = me.role === 'admin' ? equipment.map((e) => e.id) : myManaged.map((m) => m.equipmentId)
  return (
    <div>
      <p className="text-sm font-medium text-subtle">02 — Certifications</p>
      <h1 className="mt-1 text-2xl font-semibold text-default">Certification matrix</h1>
      <Matrix users={users} equipment={equipment} certs={certs} editable={editable} />
    </div>
  )
}
