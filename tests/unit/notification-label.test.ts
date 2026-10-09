import { describe, it, expect } from 'vitest'
import { NOTIFICATION_LABEL, notificationTitle } from '@/lib/notification-label'

describe('notificationTitle', () => {
  it('reads the tray label for known types', () => {
    expect(notificationTitle('booking_reminder')).toBe('Upcoming booking')
    expect(notificationTitle('training_request')).toBe('Training request')
    expect(notificationTitle('message_dm')).toBe('New direct message')
  })
  it('falls back to the app name for an unknown type', () => {
    expect(notificationTitle('nope')).toBe('LabHub')
  })
  it('labels every NotificationType notify() can write', () => {
    // Mirrors src/lib/notify.ts NotificationType — a new type needs a title here.
    for (const t of ['booking_pending', 'booking_decided', 'booking_cancelled_maintenance', 'booking_reminder',
      'booking_expired', 'booking_cancelled', 'message_mention', 'message_dm', 'channel_added', 'message_thread_reply',
      'issue_assigned', 'issue_mention', 'issue_comment', 'issue_done', 'project_update_prompt', 'feedback_new',
      'feedback_decided', 'training_request', 'training_decided']) {
      expect(NOTIFICATION_LABEL[t], t).toBeTruthy()
    }
  })
})
