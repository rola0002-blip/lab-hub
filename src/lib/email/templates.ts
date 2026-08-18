import { googleCalendarLink, outlookCalendarLink } from '@/features/calendar/links'

type Tpl = { subject: string; html: string }
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const wrap = (body: string) => `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">${body}</div>`

export function inviteEmail(orgName: string, link: string): Tpl {
  return {
    subject: `You're invited to join ${orgName}`,
    html: wrap(`<h2>${esc(orgName)}</h2><p>You've been invited. Click below to create your account (link expires in 7 days).</p><p><a href="${link}">Accept invitation</a></p>`),
  }
}
export function resetPasswordEmail(orgName: string, link: string): Tpl {
  return { subject: `Reset your ${orgName} password`, html: wrap(`<p><a href="${link}">Reset your password</a> (link expires in 1 hour).</p>`) }
}
export function bookingPendingEmail(orgName: string, requesterName: string, equipmentName: string, when: string): Tpl {
  return { subject: `[${orgName}] Booking approval needed: ${equipmentName}`, html: wrap(`<p><strong>${esc(requesterName)}</strong> requested <strong>${esc(equipmentName)}</strong><br>${esc(when)}</p><p>Review it in the Approvals queue.</p>`) }
}
export function bookingDecidedEmail(
  orgName: string, equipmentName: string, when: string, approved: boolean, reason?: string,
  cal?: { appUrl: string; event?: { startsAt: Date; endsAt: Date; location: string } },
): Tpl {
  // Calendar links only on APPROVAL. A single-event decide (decideBooking) supplies
  // cal.event → Google + Outlook quick-add anchors + an Open-in-LabHub deep link.
  // A recurring decide (decideRecurring) supplies cal WITHOUT event → only the Open
  // link (the subscription feed is the right tool for a series). Rejections: no links.
  let extra = ''
  if (approved && cal) {
    if (cal.event) {
      const g = googleCalendarLink({ summary: equipmentName, start: cal.event.startsAt, end: cal.event.endsAt, details: '', location: cal.event.location })
      const o = outlookCalendarLink({ summary: equipmentName, start: cal.event.startsAt, end: cal.event.endsAt, details: '', location: cal.event.location })
      extra += `<p>Add to your calendar: <a href="${g}">Google</a> &middot; <a href="${o}">Outlook</a></p>`
    }
    extra += `<p><a href="${cal.appUrl}/bookings">Open in ${esc(orgName)}</a></p>`
  }
  return {
    subject: `[${orgName}] Booking ${approved ? 'approved' : 'rejected'}: ${equipmentName}`,
    html: wrap(`<p>Your booking of <strong>${esc(equipmentName)}</strong> (${esc(when)}) was <strong>${approved ? 'approved' : 'rejected'}</strong>.</p>${reason ? `<p>Reason: ${esc(reason)}</p>` : ''}${extra}`),
  }
}
export function bookingCancelledMaintenanceEmail(orgName: string, equipmentName: string, when: string, reason: string): Tpl {
  return { subject: `[${orgName}] Booking cancelled (maintenance): ${equipmentName}`, html: wrap(`<p>Your booking of <strong>${esc(equipmentName)}</strong> (${esc(when)}) was cancelled for maintenance: ${esc(reason)}.</p>`) }
}
export function bookingCancelledUserDeactivatedEmail(orgName: string, userName: string, equipmentName: string, when: string): Tpl {
  return { subject: `[${orgName}] Booking cancelled: ${userName} deactivated`, html: wrap(`<p><strong>${esc(userName)}</strong> was deactivated; their booking of <strong>${esc(equipmentName)}</strong> (${esc(when)}) was cancelled.</p>`) }
}
export function bookingReminderEmail(orgName: string, equipmentName: string, when: string): Tpl {
  return { subject: `[${orgName}] Upcoming booking: ${equipmentName}`, html: wrap(`<p>Reminder: you have <strong>${esc(equipmentName)}</strong> ${esc(when)}.</p>`) }
}
export function mentionEmail(orgName: string, senderName: string, where: string, preview: string): Tpl {
  return {
    subject: `[${orgName}] ${senderName} mentioned you in ${where}`,
    html: wrap(`<p><strong>${esc(senderName)}</strong> mentioned you in <strong>${esc(where)}</strong>:</p><p>${esc(preview)}</p><p>Open ${esc(orgName)} to reply.</p>`),
  }
}
export function dmEmail(orgName: string, senderName: string, preview: string): Tpl {
  return {
    subject: `[${orgName}] Direct message from ${senderName}`,
    html: wrap(`<p><strong>${esc(senderName)}</strong> sent you a direct message:</p><p>${esc(preview)}</p><p>Open ${esc(orgName)} to reply.</p>`),
  }
}
export function issueAssignedEmail(orgName: string, actorName: string, identifier: string, title: string): Tpl {
  return {
    subject: `[${orgName}] ${identifier} assigned to you: ${title}`,
    html: wrap(`<p><strong>${esc(actorName)}</strong> assigned you <strong>${esc(identifier)}</strong> — ${esc(title)}.</p><p>Open ${esc(orgName)} to view it.</p>`),
  }
}
export function issueMentionEmail(orgName: string, actorName: string, identifier: string, where: string, title: string): Tpl {
  return {
    subject: `[${orgName}] ${actorName} mentioned you on ${identifier}`,
    html: wrap(`<p><strong>${esc(actorName)}</strong> mentioned you in ${esc(where)} on <strong>${esc(identifier)}</strong> — ${esc(title)}.</p><p>Open ${esc(orgName)} to reply.</p>`),
  }
}
export function issueCommentEmail(orgName: string, actorName: string, identifier: string, title: string, preview: string): Tpl {
  return {
    subject: `[${orgName}] New comment on ${identifier}: ${title}`,
    html: wrap(`<p><strong>${esc(actorName)}</strong> commented on <strong>${esc(identifier)}</strong> — ${esc(title)}:</p><p>${esc(preview)}</p><p>Open ${esc(orgName)} to reply.</p>`),
  }
}
export function issueDoneEmail(orgName: string, actorName: string, identifier: string, title: string): Tpl {
  return {
    subject: `[${orgName}] ${identifier} completed: ${title}`,
    html: wrap(`<p><strong>${esc(actorName)}</strong> marked <strong>${esc(identifier)}</strong> — ${esc(title)} as done.</p>`),
  }
}
export function digestChatEmail(orgName: string, items: { message: string; href: string }[], appUrl: string): Tpl {
  const shown = items.slice(0, 20)
  const rows = shown.map((i) => `<li style="margin:4px 0"><a href="${esc(appUrl + i.href)}">${esc(i.message)}</a></li>`).join('')
  const more = items.length > shown.length ? `<p>…and ${items.length - shown.length} more.</p>` : ''
  return {
    subject: `[${orgName}] Unread chat — ${items.length} message${items.length === 1 ? '' : 's'}`,
    html: wrap(`<p>You have unread chat messages in ${esc(orgName)}:</p><ul>${rows}</ul>${more}<p>Open ${esc(orgName)} to catch up.</p>`),
  }
}
