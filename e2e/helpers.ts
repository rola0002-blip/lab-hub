import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import type { Page } from '@playwright/test'

const TEST_DB = 'postgresql://labhub:labhub@localhost:5432/labhub_test'

// Prisma 7 requires a driver adapter for the runtime connection — the brief's
// `new PrismaClient({ datasources: ... })` throws under Prisma 7. Mirror the
// adapter pattern from src/lib/db.ts, but point PrismaPg straight at the test
// database (this process is Playwright's runner, not the app, so it does not
// read DATABASE_URL from the webServer env).
export const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DB }) })

export async function wipe() {
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE "Notification","EmailOutbox","Booking","RecurrenceRule",
      "MaintenanceWindow","Certification","EquipmentManager","Equipment",
      "Invitation","Organization","session","account","verification","user" CASCADE
  `)
}

export const ADMIN = { email: 'pi@lab.test', password: 'Str0ngPass!123', name: 'Roland' }

export async function runWizard(page: Page) {
  await page.goto('/setup')
  await page.fill('input[name=orgName]', 'TAY LABS')
  await page.fill('input[name=adminName]', ADMIN.name)
  await page.fill('input[name=adminEmail]', ADMIN.email)
  await page.fill('input[name=adminPassword]', ADMIN.password)
  await page.click('button:has-text("Finish setup")')
  await page.waitForURL('**/sign-in')
}

export async function signIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in')
  await page.fill('input[name=email]', email)
  await page.fill('input[name=password]', password)
  await page.click('button:has-text("Sign in")')
  await page.waitForURL('**/dashboard')
}

export async function latestInviteToken(email: string): Promise<string> {
  const inv = await db.invitation.findFirstOrThrow({ where: { email }, orderBy: { createdAt: 'desc' } })
  return inv.token
}
