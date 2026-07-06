import 'server-only'
import { redirect } from 'next/navigation'
import { prisma } from './db'
import type { Organization } from '@prisma/client'

export async function getOrg(): Promise<Organization | null> {
  return prisma.organization.findFirst()
}

export async function requireSetup(): Promise<Organization> {
  const org = await getOrg()
  if (!org?.setupComplete) redirect('/setup')
  return org
}
