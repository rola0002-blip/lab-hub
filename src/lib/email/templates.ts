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
export function bookingDecidedEmail(orgName: string, equipmentName: string, when: string, approved: boolean, reason?: string): Tpl {
  return {
    subject: `[${orgName}] Booking ${approved ? 'approved' : 'rejected'}: ${equipmentName}`,
    html: wrap(`<p>Your booking of <strong>${esc(equipmentName)}</strong> (${esc(when)}) was <strong>${approved ? 'approved' : 'rejected'}</strong>.</p>${reason ? `<p>Reason: ${esc(reason)}</p>` : ''}`),
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
