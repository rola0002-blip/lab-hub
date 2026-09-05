import { prisma } from '@/lib/db'
import { randomUUID } from 'node:crypto'
import { COLOSSUS_BOT_ID, LAB_UPDATES_CHANNEL_ID } from '@/features/bot'
import { rankBetween } from '@/features/issues/rank'

// Cursor for makeProject's default rank: each unranked fixture appends after the
// previous mint, so creation order is arrangement order. Reset by resetDb.
let lastProjectRank: string | null = null

export async function resetDb() {
  // A fire-and-forget bot announce (`void bot.announceToChannel` in the issue/project
  // services) from the just-finished test can still be executing when this TRUNCATE
  // grabs its ACCESS EXCLUSIVE locks, racing into a transient deadlock (40P01). The
  // straggler is short-lived, so retry the TRUNCATE — by the retry it has settled.
  // (Mirrors the deadlock-as-retryable handling in booking createBooking.)
  for (let attempt = 0; ; attempt++) {
    try {
      await prisma.$executeRawUnsafe(`
        TRUNCATE TABLE "Feedback",
          "Document","DocumentFolder",
          "ProjectUpdate","ProjectUpdateAttachment",
          "IssueActivity","IssueAttachment","IssueComment","IssueLabel",
          "Label","Issue","Project",
          "Conversation","ConversationMember","Message","Reaction",
          "ChatAttachment","PushSubscription",
          "Notification","EmailOutbox","Booking","RecurrenceRule",
          "TrainingRecord","MaintenanceWindow","Certification","EquipmentManager","Equipment",
          "Invitation","Organization","session","account","verification","user" CASCADE
      `)
      break
    } catch (e) {
      const msg = String(e).toLowerCase()
      if (attempt < 5 && (msg.includes('deadlock') || msg.includes('40p01') || msg.includes('p2034'))) {
        await new Promise((r) => setTimeout(r, 20 * (attempt + 1)))
        continue
      }
      throw e
    }
  }
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE "issue_number_seq" RESTART WITH 1`)
  lastProjectRank = null
}

export async function makeUser(over: { role?: string; name?: string; banned?: boolean } = {}) {
  const id = randomUUID()
  return prisma.user.create({
    data: {
      id,
      name: over.name ?? `User ${id.slice(0, 6)}`,
      email: `${id.slice(0, 12)}@test.local`,
      emailVerified: true,
      role: over.role ?? 'member',
      banned: over.banned ?? false,
    },
  })
}

export async function makeEquipment(over: Record<string, unknown> = {}) {
  return prisma.equipment.create({
    data: {
      name: `Instr ${randomUUID().slice(0, 6)}`,
      description: 'test instrument',
      location: 'Lab 1',
      ...over,
    },
  })
}

export function hoursFromNow(h: number) {
  return new Date(Date.now() + h * 3_600_000)
}

export async function makeChannel(over: Record<string, unknown> = {}) {
  return prisma.conversation.create({
    data: { type: 'CHANNEL', name: `chan-${randomUUID().slice(0, 6)}`, createdById: 'seed', ...over },
  })
}

export async function makeDm(userIds: string[]) {
  const dmKey = [...userIds].sort().join('|')
  const convo = await prisma.conversation.create({ data: { type: 'DM', createdById: userIds[0], dmKey } })
  await prisma.conversationMember.createMany({ data: userIds.map((userId) => ({ conversationId: convo.id, userId })) })
  return convo
}

export async function makeMember(conversationId: string, userId: string, over: Record<string, unknown> = {}) {
  return prisma.conversationMember.create({ data: { conversationId, userId, ...over } })
}

export async function makeMessage(conversationId: string, userId: string, over: Record<string, unknown> = {}) {
  return prisma.message.create({ data: { conversationId, userId, body: `msg ${randomUUID().slice(0, 6)}`, ...over } })
}

export async function makeProject(over: Record<string, unknown> = {}) {
  // An explicit `rank` in `over` wins (spread last) and ADVANCES the cursor past
  // itself, so the next default mint is still strictly later than every fixture
  // before it. Two rows sharing a key would leave the read order to Postgres —
  // neither listProjects nor listProjectOptions has a tiebreak.
  let rank: string
  if (over.rank !== undefined) {
    rank = over.rank as string
    if (lastProjectRank === null || rank > lastProjectRank) lastProjectRank = rank
  } else {
    rank = lastProjectRank = rankBetween(lastProjectRank, null)
  }
  return prisma.project.create({ data: { name: `Project ${randomUUID().slice(0, 6)}`, rank, ...over } })
}

export async function makeProjectUpdate(projectId: string, authorId: string, over: Record<string, unknown> = {}) {
  return prisma.projectUpdate.create({ data: { projectId, authorId, health: 'ON_TRACK', body: `update ${randomUUID().slice(0, 6)}`, ...over } })
}

export async function makeLabel(over: Record<string, unknown> = {}) {
  return prisma.label.create({ data: { name: `label-${randomUUID().slice(0, 6)}`, color: '--status-todo', ...over } })
}

export async function makeIssue(creatorId: string, over: Record<string, unknown> = {}) {
  return prisma.issue.create({ data: { title: `Issue ${randomUUID().slice(0, 6)}`, creatorId, rank: 'V', ...over } })
}

export async function makeIssueComment(issueId: string, userId: string, over: Record<string, unknown> = {}) {
  return prisma.issueComment.create({ data: { issueId, userId, body: `note ${randomUUID().slice(0, 6)}`, ...over } })
}

export async function makeDocumentFolder(over: Record<string, unknown> = {}) {
  const createdById = (over.createdById as string) ?? (await makeUser()).id
  return prisma.documentFolder.create({ data: { name: `folder-${randomUUID().slice(0, 6)}`, createdById, ...over } })
}

export async function makeDocument(uploaderId: string, over: Record<string, unknown> = {}) {
  const uuid = randomUUID().slice(0, 12)
  return prisma.document.create({
    data: { name: `doc-${uuid}.pdf`, path: `/uploads/documents/${uuid}.pdf`, mime: 'application/pdf', size: 1024, uploaderId, ...over },
  })
}

// authorId is required (the FK column is NOT NULL) but rides inside `over` rather than
// a positional argument, unlike makeDocument/makeProjectUpdate — the v0.13 task
// interfaces are written against that one-object shape. appVersion/userAgent are
// server-stamped in production, so the fixtures carry obvious test values.
export async function makeFeedback(
  over: { authorId: string } & Partial<{
    type: 'BUG' | 'IDEA'
    status: 'NEW' | 'REVIEWED' | 'PLANNED' | 'DONE' | 'DECLINED'
    body: string
    pagePath: string
    screenshotPath: string | null
    appVersion: string
    userAgent: string
  }>,
) {
  return prisma.feedback.create({
    data: { type: 'BUG', body: 'Test feedback', pagePath: '/dashboard', appVersion: '0.0.0-test', userAgent: 'test-agent', ...over },
  })
}

export async function makeRaAcknowledgment(userId: string, documentId: string, over: Record<string, unknown> = {}) {
  return prisma.raAcknowledgment.create({
    data: { userId, documentId, documentName: 'ra-test.pdf', matricNumber: 'A0123456X', ...over },
  })
}

// Re-create the system rows the SP5 seed migration installs (resetDb TRUNCATEs them
// away). Idempotent — SP5 integration tests call this in their beforeEach after
// resetDb when they need the bot / #lab-updates present.
export async function seedSystem() {
  await prisma.user.upsert({
    where: { id: COLOSSUS_BOT_ID },
    update: {},
    create: { id: COLOSSUS_BOT_ID, name: 'LabHub Bot', email: 'bot@colossus.local', emailVerified: true, role: 'member', isSystem: true },
  })
  await prisma.conversation.upsert({
    where: { id: LAB_UPDATES_CHANNEL_ID },
    update: {},
    create: { id: LAB_UPDATES_CHANNEL_ID, type: 'CHANNEL', name: 'lab-updates', isPrivate: false, createdById: COLOSSUS_BOT_ID },
  })
  await prisma.conversationMember.upsert({
    where: { conversationId_userId: { conversationId: LAB_UPDATES_CHANNEL_ID, userId: COLOSSUS_BOT_ID } },
    update: {},
    create: { conversationId: LAB_UPDATES_CHANNEL_ID, userId: COLOSSUS_BOT_ID },
  })
}
