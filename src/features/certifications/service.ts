import 'server-only'
import { prisma } from '@/lib/db'
import { isManagerOf } from '@/features/equipment/service'

async function assertCanManage(byId: string, equipmentId: string) {
  if (!(await isManagerOf(byId, equipmentId))) throw new Error('forbidden')
}

export async function grantCertification(args: { userId: string; equipmentId: string; grantedById: string }): Promise<void> {
  await assertCanManage(args.grantedById, args.equipmentId)
  await prisma.certification.upsert({
    where: { userId_equipmentId: { userId: args.userId, equipmentId: args.equipmentId } },
    update: {},
    create: { userId: args.userId, equipmentId: args.equipmentId, grantedById: args.grantedById },
  })
}

export async function revokeCertification(args: { userId: string; equipmentId: string; byId: string }): Promise<void> {
  await assertCanManage(args.byId, args.equipmentId)
  await prisma.certification.deleteMany({ where: { userId: args.userId, equipmentId: args.equipmentId } })
}

export async function isCertified(userId: string, equipmentId: string): Promise<boolean> {
  return !!(await prisma.certification.findUnique({ where: { userId_equipmentId: { userId, equipmentId } } }))
}
