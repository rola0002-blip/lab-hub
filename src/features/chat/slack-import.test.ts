import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { buildImportPlan, type SlackUser, type SlackChannel, type SlackMsg } from './slack-import'

// Unit-safe: read the fixture tree straight off disk (no DB). This mirrors what
// the CLI does but keeps the transform under test pure.
const FIXTURE = path.resolve(__dirname, '../../../tests/fixtures/slack-export')

function readFixture() {
  const users = JSON.parse(readFileSync(path.join(FIXTURE, 'users.json'), 'utf8')) as SlackUser[]
  const channels = JSON.parse(readFileSync(path.join(FIXTURE, 'channels.json'), 'utf8')) as SlackChannel[]
  const messagesByChannel: Record<string, SlackMsg[]> = {}
  for (const ch of channels) {
    const dir = path.join(FIXTURE, ch.name)
    const msgs: SlackMsg[] = []
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
      msgs.push(...(JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as SlackMsg[]))
    }
    messagesByChannel[ch.id] = msgs
  }
  return { users, channels, messagesByChannel }
}

describe('buildImportPlan', () => {
  const plan = buildImportPlan(readFixture())
  const byTs = (ts: string) => plan.messages.find((m) => m.slackTs === ts)!

  it('imports 8 messages and skips other subtypes (join/leave/bot)', () => {
    expect(plan.messages).toHaveLength(8) // 7 general + 1 secret
    // the channel_join message (ts .000350) is dropped, unlike thread_broadcast/file_share
    expect(plan.messages.some((m) => m.slackTs === '1705300250.000350')).toBe(false)
  })

  it('imports thread_broadcast as a reply linked to the thread root', () => {
    expect(byTs('1705300400.000600')).toMatchObject({
      authorSlackId: 'U1',
      threadParentTs: '1705300100.000200',
      body: 'broadcasting to channel',
    })
  })

  it('imports file_share with its text plus a 📎 file line', () => {
    expect(byTs('1705300500.000700').body).toBe('sharing a file\n📎 paper.pdf: https://files.slack.com/y')
  })

  it('rosters a ghost author absent from users.json as an Unknown placeholder', () => {
    // U9 authors a message and reacts, but never appears in users.json.
    expect(plan.placeholderUsers).toContainEqual({
      slackId: 'U9',
      name: 'Unknown (U9)',
      email: 'slack-U9@import.invalid',
    })
    // its message survives, attributed to U9 rather than being silently dropped.
    expect(byTs('1705300600.000800')).toMatchObject({ authorSlackId: 'U9', body: 'ghost speaks' })
  })

  it('keeps a reaction by a ghost reactor so apply can resolve it', () => {
    expect(byTs('1705300100.000200').reactions).toEqual([{ emoji: '❤️', userSlackIds: ['U9'] }])
  })

  it('rewrites <@U2> mentions to plain @real_name text', () => {
    expect(byTs('1705300000.000100').body).toBe('hello @Alumni team')
  })

  it('marks thread roots with null parent and replies with the parent ts', () => {
    expect(byTs('1705300000.000100').threadParentTs).toBeNull() // no thread_ts
    expect(byTs('1705300100.000200').threadParentTs).toBeNull() // thread_ts === ts → root
    expect(byTs('1705300200.000300').threadParentTs).toBe('1705300100.000200') // reply
  })

  it('appends file lines and keeps empty-text file messages', () => {
    expect(byTs('1705300300.000400').body).toBe('📎 data.csv: https://files.slack.com/x')
  })

  it('maps reaction names through the emoji table', () => {
    expect(byTs('1705300200.000300').reactions).toEqual([{ emoji: '👍', userSlackIds: ['U2'] }])
    expect(byTs('1705300000.000100').reactions).toEqual([])
  })

  it('converts ts to exact millisecond timestamps', () => {
    expect(byTs('1705300000.000100').createdAtMs).toBe(1705300000000)
    expect(byTs('1705300100.000200').createdAtMs).toBe(1705300100000)
  })

  it('synthesizes a placeholder email for users without one', () => {
    expect(plan.placeholderUsers).toContainEqual({
      slackId: 'U3',
      name: 'Visitor',
      email: 'slack-U3@import.invalid',
    })
    // users with a real email carry it through (the CLI resolves the match)
    expect(plan.placeholderUsers).toContainEqual({ slackId: 'U1', name: 'Roland', email: 'pi@lab.test' })
    expect(plan.placeholderUsers).toContainEqual({ slackId: 'U2', name: 'Alumni', email: 'left@lab.test' })
  })

  it('carries channel metadata including private flag, topic and members', () => {
    const secret = plan.channels.find((c) => c.slackChannelId === 'C2')!
    expect(secret).toMatchObject({ name: 'secret', isPrivate: true, topic: 'PI only', memberSlackIds: ['U1'] })
    const general = plan.channels.find((c) => c.slackChannelId === 'C1')!
    expect(general).toMatchObject({ isPrivate: false, memberSlackIds: ['U1', 'U2', 'U3'] })
  })

  it('attributes messages to their slack author and channel', () => {
    expect(byTs('1705400000.000500')).toMatchObject({ slackChannelId: 'C2', authorSlackId: 'U1' })
  })
})
