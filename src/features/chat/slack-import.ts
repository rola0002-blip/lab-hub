// Pure Slack-export transform: no I/O, no clock. Given parsed export JSON it
// produces an ImportPlan the DB-apply step (slack-import-apply.ts) consumes.
// Every rule here is pinned by slack-import.test.ts against tests/fixtures.

export type SlackUser = {
  id: string
  name: string
  profile: { email?: string; real_name?: string }
  deleted?: boolean
}

export type SlackChannel = {
  id: string
  name: string
  is_private?: boolean
  topic?: { value?: string }
  members?: string[]
}

export type SlackMsg = {
  type: string
  subtype?: string
  user?: string
  text?: string
  ts: string
  thread_ts?: string
  reactions?: { name: string; users: string[] }[]
  files?: { name?: string; url_private?: string }[]
}

export type ImportPlan = {
  // Roster of referenced slack users with the email to resolve against. Users
  // without a slack email get a synthetic `slack-<id>@import.invalid`; the CLI
  // matches each by email → existing LabHub user, else creates a placeholder.
  placeholderUsers: { slackId: string; name: string; email: string }[]
  channels: { slackChannelId: string; name: string; isPrivate: boolean; topic: string; memberSlackIds: string[] }[]
  messages: {
    slackChannelId: string
    slackTs: string
    authorSlackId: string
    body: string
    threadParentTs: string | null
    createdAtMs: number
    reactions: { emoji: string; userSlackIds: string[] }[]
  }[]
}

// Slack reaction short-names → unicode. Unknown names are dropped.
export const EMOJI: Record<string, string> = {
  '+1': '👍',
  heart: '❤️',
  joy: '😂',
  tada: '🎉',
  white_check_mark: '✅',
  eyes: '👀',
  fire: '🔥',
  pray: '🙏',
}

const displayName = (u: SlackUser) => u.profile?.real_name || u.name

// Rewrite Slack `<@U123>` / `<@U123|label>` mentions to plain `@name` text.
// Keeping history readable without minting fake LabHub mention tokens/notifications.
function rewriteMentions(text: string, nameById: Map<string, string>): string {
  return text.replace(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g, (_m, id: string) => `@${nameById.get(id) ?? id}`)
}

export function buildImportPlan(input: {
  users: SlackUser[]
  channels: SlackChannel[]
  messagesByChannel: Record<string, SlackMsg[]>
}): ImportPlan {
  const nameById = new Map(input.users.map((u) => [u.id, displayName(u)]))

  const placeholderUsers = input.users.map((u) => ({
    slackId: u.id,
    name: displayName(u),
    email: u.profile?.email ?? `slack-${u.id}@import.invalid`,
  }))

  const channels = input.channels.map((c) => ({
    slackChannelId: c.id,
    name: c.name,
    isPrivate: !!c.is_private,
    topic: c.topic?.value ?? '',
    memberSlackIds: c.members ?? [],
  }))

  const messages: ImportPlan['messages'] = []
  for (const c of input.channels) {
    for (const m of input.messagesByChannel[c.id] ?? []) {
      if (m.type !== 'message' || m.subtype || !m.user) continue // skip joins/leaves/bots
      const raw = m.text ?? ''
      const files = m.files ?? []
      if (!raw.trim() && files.length === 0) continue // empty with no files

      const parts: string[] = []
      const rewritten = rewriteMentions(raw, nameById)
      if (rewritten) parts.push(rewritten)
      for (const f of files) parts.push(`📎 ${f.name ?? 'file'}: ${f.url_private ?? ''}`)

      const reactions = (m.reactions ?? [])
        .filter((r) => EMOJI[r.name])
        .map((r) => ({ emoji: EMOJI[r.name], userSlackIds: r.users }))

      messages.push({
        slackChannelId: c.id,
        slackTs: m.ts,
        authorSlackId: m.user,
        body: parts.join('\n'),
        threadParentTs: m.thread_ts && m.thread_ts !== m.ts ? m.thread_ts : null,
        createdAtMs: Math.round(parseFloat(m.ts) * 1000),
        reactions,
      })
    }
  }

  return { placeholderUsers, channels, messages }
}
