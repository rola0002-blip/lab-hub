// Bell row titles — pure + CLIENT-SAFE. ONE source for the bell tray (bell.tsx)
// and every pop-out a bell row raises — the in-app popup (bell.tsx) and the idle
// web push (notify.ts) — so a notification reads the same in the tray, the OS
// popup and on the phone (W20-C).
export const NOTIFICATION_LABEL: Record<string, string> = {
  booking_pending: 'Booking needs approval',
  booking_decided: 'Booking decision',
  booking_cancelled_maintenance: 'Booking cancelled (maintenance)',
  booking_reminder: 'Upcoming booking',
  booking_expired: 'Booking request expired',
  booking_cancelled: 'Booking cancelled',
  message_mention: 'You were mentioned',
  message_dm: 'New direct message',
  message_thread_reply: 'New thread reply',
  channel_added: 'Added to a channel',
  issue_assigned: 'Issue assigned to you',
  issue_mention: 'You were mentioned on an issue',
  issue_comment: 'New comment on an issue',
  issue_done: 'Your issue was completed',
  project_update_prompt: 'Project update due',
  feedback_new: 'New feedback',
  feedback_decided: 'Feedback update',
  // v0.32 training requests: managers/admins on a new open request, the requester
  // on a decision (Task 6's notification lane — the Task 7 fold-in).
  training_request: 'Training request',
  training_decided: 'Training decision',
}

// Pop-out title for a row; an unknown type still reads as the app, never a raw key.
export function notificationTitle(type: string): string {
  return NOTIFICATION_LABEL[type] ?? 'LabHub'
}
