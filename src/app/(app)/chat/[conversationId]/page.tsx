import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { isMember, canManage } from '@/features/chat/conversation-service'
import MessagePane from '@/components/chat/message-pane'

export default async function ConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const user = await requireUser()
  const { conversationId } = await params
  if (!(await isMember(user.id, conversationId))) notFound()
  const convo = await prisma.conversation.findUnique({ where: { id: conversationId } })
  if (!convo) notFound()
  const [manage, members] = await Promise.all([
    canManage(user.id, conversationId),
    prisma.conversationMember.findMany({ where: { conversationId }, select: { userId: true } }),
  ])
  return (
    <MessagePane
      conversationId={conversationId}
      conversationType={convo.type}
      channelName={convo.name}
      archived={!!convo.archivedAt}
      selfRole={user.role}
      manage={manage}
      memberIds={members.map((m) => m.userId)}
    />
  )
}
