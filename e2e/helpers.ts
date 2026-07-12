import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { expect, type Page } from '@playwright/test'

const TEST_DB = 'postgresql://labhub:labhub@localhost:5432/labhub_test'

// Prisma 7 requires a driver adapter for the runtime connection — the brief's
// `new PrismaClient({ datasources: ... })` throws under Prisma 7. Mirror the
// adapter pattern from src/lib/db.ts, but point PrismaPg straight at the test
// database (this process is Playwright's runner, not the app, so it does not
// read DATABASE_URL from the webServer env).
export const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DB }) })

export async function wipe() {
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE "IssueActivity","IssueAttachment","IssueComment","IssueLabel",
      "Label","Issue","Project",
      "Conversation","ConversationMember","Message","Reaction",
      "ChatAttachment","PushSubscription",
      "Notification","EmailOutbox","Booking","RecurrenceRule",
      "MaintenanceWindow","Certification","EquipmentManager","Equipment",
      "Invitation","Organization","session","account","verification","user" CASCADE
  `)
  await db.$executeRawUnsafe(`ALTER SEQUENCE "issue_number_seq" RESTART WITH 1`)
}

export const ADMIN = { email: 'pi@lab.test', password: 'Str0ngPass!123', name: 'Roland' }

export async function runWizard(page: Page) {
  await page.goto('/setup')
  await page.fill('input[name=orgName]', 'COLOSSUS')
  await page.fill('input[name=adminName]', ADMIN.name)
  await page.fill('input[name=adminEmail]', ADMIN.email)
  await page.fill('input[name=adminPassword]', ADMIN.password)
  await page.click('button:has-text("Finish setup")')
  await page.waitForURL('**/sign-in')
}

// Sign out via the sidebar workspace-header menu (the standalone header button
// was replaced by the grouped sidebar in the COLOSSUS redesign): open the menu,
// then click the "Sign out" item.
export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Workspace menu' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
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

// Invite a member/guest from the admin's People page and return the accept-invite token.
// (The brief's helper signature carried a `name` argument; the invite form only needs
// email + role, so the display name is supplied later at acceptInvite time instead.)
export async function createMemberViaInvite(page: Page, email: string, role: 'member' | 'guest'): Promise<string> {
  await page.goto('/people')
  await page.fill('input[name=email]', email)
  await page.selectOption('select[name=role]', role)
  await page.click('button:has-text("Invite")')
  await page.getByText('Invitation sent.').waitFor()
  return latestInviteToken(email)
}

// Accept an invite in a fresh browser context: creates the account and lands on /dashboard,
// already signed in as the new member (mirrors journeys.spec.ts's accept flow).
export async function acceptInvite(page: Page, token: string, name: string, password: string): Promise<void> {
  await page.goto(`/accept-invite/${token}`)
  await page.fill('input[name=name]', name)
  await page.fill('input[name=password]', password)
  await page.click('button:has-text("Create account")')
  await page.waitForURL('**/dashboard')
}

// Create an issue through the create modal (T13). T16 uses this to seed the board
// for keyboard + pointer move specs. Selector contract for the T13 modal: a
// `New issue` trigger button, an `Issue title` labelled field, and a `Create issue`
// submit button. On success the modal redirects to the new issue's detail page.
export async function createIssueViaUI(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New issue' }).first().click()
  await page.getByLabel('Issue title').fill(title)
  await page.getByRole('button', { name: 'Create issue' }).click()
  // The composer's `router.push` lands on /issues/COL-<n>. The detail page renders
  // the title as an editable <input value> for admins/members (getByText never
  // matches an input value) and as an <h1> for guests — so wait for the redirect,
  // then assert whichever rendering carries our title. This is the durable signal
  // the create succeeded, not a getByText race against the input value.
  await page.waitForURL(/\/issues\/COL-\d+$/)
  const asInput = page.getByRole('textbox', { name: 'Issue title' })
  if (await asInput.count()) await expect(asInput).toHaveValue(title)
  else await expect(page.getByRole('heading', { name: title })).toBeVisible()
}
