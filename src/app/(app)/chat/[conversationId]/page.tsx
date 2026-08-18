import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { isMember, canManage } from '@/features/chat/conversation-service'
import MessagePane from '@/components/chat/message-pane'

export default async function ConversationPage({ params, searchParams }: {
  params: Promise<{ conversationId: string }>
  // `?msg=` deep-link target (search result / copy-link). Read here and passed as
  // a prop so a same-conversation soft-navigation re-triggers the pane's scroll.
  searchParams: Promise<{ msg?: string }>
}) {
  const user = await requireUser()
  const { conversationId } = await params
  const { msg } = await searchParams
  if (!(await isMember(user.id, conversationId))) notFound()
  const convo = await prisma.conversation.findUnique({ where: { id: conversationId } })
  if (!convo) notFound()
  // F7: remember the last-opened conversation for the landing redirect
  // (landingHrefFor re-validates membership + archive at read; stale is benign).
  void prisma.user.update({ where: { id: user.id }, data: { lastConversationId: conversationId } }).catch(() => {})
  const [manage, members] = await Promise.all([
    canManage(user.id, conversationId),
    prisma.conversationMember.findMany({ where: { conversationId }, select: { userId: true } }),
  ])
  return (
    <MessagePane
      conversationId={conversationId}
      conversationType={convo.type}
      channelName={convo.name}
      topic={convo.topic}
      archived={!!convo.archivedAt}
      selfRole={user.role}
      manage={manage}
      memberIds={members.map((m) => m.userId)}
      deepLinkMsgId={msg ?? null}
    />
  )
}
