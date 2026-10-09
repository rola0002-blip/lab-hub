import { describe, it, expect } from 'vitest'
import { rowAlerts, isRowAlertable, shouldAlertRow, shouldPingFromMessage, alertRendering, decideAlert, MAX_ROW_ALERTS, ROW_ALERT_MAX_AGE_MS } from './chime'
import { COLOSSUS_BOT_ID } from '@/features/bot/ids'

const NOW = Date.parse('2026-01-01T00:10:00.000Z')
const item = (id: string, type: string, createdAt: string, payload: Record<string, unknown> = {}) => ({ id, type, createdAt, payload })

describe('isRowAlertable', () => {
  it('every non-chat row alerts', () => {
    for (const t of ['booking_reminder', 'issue_assigned', 'training_request', 'feedback_new', 'channel_added', 'project_update_prompt']) {
      expect(isRowAlertable({ type: t, payload: {} }), t).toBe(true)
    }
  })
  it('a human chat row does not (the msg path + fanout already alerted)', () => {
    expect(isRowAlertable({ type: 'message_dm', payload: { senderId: 'u1' } })).toBe(false)
    expect(isRowAlertable({ type: 'message_mention', payload: {} })).toBe(false)
    expect(isRowAlertable({ type: 'message_thread_reply', payload: null })).toBe(false)
  })
  it('a BOT chat row does (due-soon / overdue DMs)', () => {
    expect(isRowAlertable({ type: 'message_dm', payload: { senderId: COLOSSUS_BOT_ID } })).toBe(true)
  })
})

describe('rowAlerts', () => {
  it('first load seeds the watermark silently', () => {
    const r = rowAlerts(null, [item('1', 'booking_reminder', '2026-01-01T00:09:00.000Z')], NOW)
    expect(r).toEqual({ watermark: '2026-01-01T00:09:00.000Z', alerts: [] })
  })
  it('first load with an empty tray seeds an empty watermark, and the next row alerts', () => {
    const seeded = rowAlerts(null, [], NOW)
    expect(seeded).toEqual({ watermark: '', alerts: [] })
    expect(rowAlerts(seeded.watermark, [item('1', 'issue_assigned', '2026-01-01T00:09:00.000Z')], NOW).alerts.map((a) => a.id)).toEqual(['1'])
  })
  it('alerts alertable rows newer than the watermark; skips human chat rows and older rows', () => {
    const w = '2026-01-01T00:05:00.000Z'
    const r = rowAlerts(w, [
      item('3', 'message_dm', '2026-01-01T00:08:00.000Z', { senderId: 'u1' }),
      item('2', 'issue_assigned', '2026-01-01T00:07:00.000Z'),
      item('0', 'booking_reminder', '2026-01-01T00:04:00.000Z'),
    ], NOW)
    expect(r.watermark).toBe('2026-01-01T00:08:00.000Z')
    expect(r.alerts.map((a) => a.id)).toEqual(['2'])
  })
  it('newest-first mixed batch: a newer row must not shadow an older unseen one; alerts come oldest-first', () => {
    const r = rowAlerts('2026-01-01T00:05:00.000Z', [
      item('b', 'booking_decided', '2026-01-01T00:09:00.000Z'),
      item('a', 'training_request', '2026-01-01T00:06:00.000Z'),
    ], NOW)
    expect(r.alerts.map((a) => a.id)).toEqual(['a', 'b'])
    expect(r.watermark).toBe('2026-01-01T00:09:00.000Z')
  })
  it('caps a backlog at MAX_ROW_ALERTS, newest win', () => {
    const rows = Array.from({ length: MAX_ROW_ALERTS + 2 }, (_, i) =>
      item(String(i), 'issue_comment', `2026-01-01T00:0${i + 5}:00.000Z`)).reverse()
    const r = rowAlerts('2026-01-01T00:04:00.000Z', rows, NOW)
    expect(r.alerts).toHaveLength(MAX_ROW_ALERTS)
    expect(r.alerts.map((a) => a.id)).toEqual(['2', '3', '4'])
  })
  it('rows older than ROW_ALERT_MAX_AGE_MS only advance the watermark', () => {
    const stale = new Date(NOW - ROW_ALERT_MAX_AGE_MS - 1).toISOString()
    const r = rowAlerts('2025-12-31T00:00:00.000Z', [item('s', 'booking_reminder', stale)], NOW)
    expect(r).toEqual({ watermark: stale, alerts: [] })
  })
  it('a row already at the watermark never re-alerts (poll + notif + reconnect overlap)', () => {
    const w = '2026-01-01T00:07:00.000Z'
    expect(rowAlerts(w, [item('2', 'issue_assigned', w)], NOW).alerts).toEqual([])
  })
})

describe('shouldAlertRow', () => {
  it('suppresses a row about the open conversation only while focused', () => {
    const row = { payload: { conversationId: 'c1' } }
    expect(shouldAlertRow(row, { openCid: 'c1', focused: true })).toBe(false)
    expect(shouldAlertRow(row, { openCid: 'c1', focused: false })).toBe(true)
    expect(shouldAlertRow(row, { openCid: 'c2', focused: true })).toBe(true)
    expect(shouldAlertRow({ payload: {} }, { openCid: 'c1', focused: true })).toBe(true)
  })
})

describe('shouldPingFromMessage', () => {
  const opts = { openCid: 'c1', focused: true, selfId: 'me' }
  const base = { cid: 'c2', authorId: 'other', kind: 'text', muted: false }

  it('pings for a plain message in another conversation (focused or not)', () => {
    expect(shouldPingFromMessage(base, opts)).toBe(true)
    expect(shouldPingFromMessage(base, { ...opts, focused: false })).toBe(true)
  })
  it('muted conversation → no ping', () => {
    expect(shouldPingFromMessage({ ...base, muted: true }, opts)).toBe(false)
  })
  it('system kind → no ping', () => {
    expect(shouldPingFromMessage({ ...base, kind: 'system' }, opts)).toBe(false)
  })
  it('own message (echo of what you sent) → no ping', () => {
    expect(shouldPingFromMessage({ ...base, authorId: 'me' }, opts)).toBe(false)
  })
  it('open + focused conversation → no ping (you are reading it)', () => {
    expect(shouldPingFromMessage({ ...base, cid: 'c1' }, opts)).toBe(false)
  })
  it('open but UNfocused conversation → ping (you are away from the window)', () => {
    expect(shouldPingFromMessage({ ...base, cid: 'c1' }, { ...opts, focused: false })).toBe(true)
  })
  it('bot-authored message → no ping (its bell row, if any, is the alert)', () => {
    expect(shouldPingFromMessage({ ...base, authorId: COLOSSUS_BOT_ID }, opts)).toBe(false)
    expect(shouldPingFromMessage({ ...base, authorId: COLOSSUS_BOT_ID }, { ...opts, focused: false })).toBe(false)
  })
  it('every qualifying message alerts — no burst throttle', () => {
    const m = { cid: 'c1', authorId: 'other', muted: false }
    const opts = { openCid: null, focused: false, selfId: 'me' }
    expect(shouldPingFromMessage(m, opts)).toBe(true)
    expect(shouldPingFromMessage({ ...m }, opts)).toBe(true) // second message 1 ms later also pings
  })
})

describe('alertRendering', () => {
  it('browser/PWA: chime yes, toast no', () => {
    expect(alertRendering(false)).toEqual({ chime: true, toast: false })
  })

  it('desktop shell: OS-sounded toast yes, in-page chime suppressed (no double-ding)', () => {
    expect(alertRendering(true)).toEqual({ chime: false, toast: true })
  })
})

describe('decideAlert', () => {
  it('non-qualifying message → no alert on any surface', () => {
    expect(decideAlert(false, false)).toEqual({ chime: false, toast: false, popup: false, swPopup: false })
    expect(decideAlert(false, true)).toEqual({ chime: false, toast: false, popup: false, swPopup: false })
  })

  it('qualifying, browser tab → chime + constructor popup arm', () => {
    expect(decideAlert(true, false)).toEqual({ chime: true, toast: false, popup: true, swPopup: false })
  })

  it('qualifying, standalone PWA → chime + SW popup arm (constructor throws on installed iOS/Android)', () => {
    expect(decideAlert(true, false, true)).toEqual({ chime: true, toast: false, popup: false, swPopup: true })
  })

  it('qualifying, desktop shell → OS-sounded toast only (popup never fires in-shell)', () => {
    expect(decideAlert(true, true)).toEqual({ chime: false, toast: true, popup: false, swPopup: false })
  })

  it('shell outranks standalone (the shell marker wins even if both read true)', () => {
    expect(decideAlert(true, true, true)).toEqual({ chime: false, toast: true, popup: false, swPopup: false })
  })

  it('two SSE messages within 3 s both alert — the old burst throttle is gone', () => {
    const m = { cid: 'c1', authorId: 'other', muted: false }
    const opts = { openCid: null, focused: false, selfId: 'me' }
    expect(decideAlert(shouldPingFromMessage(m, opts), false))
      .toEqual({ chime: true, toast: false, popup: true, swPopup: false })
    expect(decideAlert(shouldPingFromMessage({ ...m }, opts), false))
      .toEqual({ chime: true, toast: false, popup: true, swPopup: false })
  })
})
