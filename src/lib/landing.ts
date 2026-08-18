import 'server-only'
import { prisma } from './db'

// Single source of truth for the post-login landing (F7): the last conversation
// you had open, if you are still a member and it is not archived; otherwise the
// personal task list. Used by BOTH / and the sign-in success path (which pushes
// '/'), so they can never disagree.
export async function landingHrefFor(userId: string | null): Promise<string> {
  if (!userId) return '/issues/me' // anonymous: / funnels onward to sign-in
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { lastConversationId: true } })
  if (!u?.lastConversationId) return '/issues/me'
  const member = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: u.lastConversationId, userId } },
    select: { conversation: { select: { archivedAt: true } } },
  })
  return member && !member.conversation.archivedAt ? `/chat/${u.lastConversationId}` : '/issues/me'
}
