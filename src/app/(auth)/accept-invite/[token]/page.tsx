import { getPendingInvitation } from '@/features/invitations/service'
import AcceptForm from './accept-form'

export default async function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const inv = await getPendingInvitation(token)
  if (!inv) {
    return (
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold text-default">Invitation not valid</h1>
        <p className="mt-2 text-muted">This invitation link is invalid, expired, or was revoked. Ask an administrator to send a new one.</p>
      </div>
    )
  }
  return <AcceptForm email={inv.email} />
}
