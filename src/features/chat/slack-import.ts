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

// Subtypes that still carry real user content and must be imported:
//   thread_broadcast — a thread reply also sent to the channel (keeps thread linkage)
//   file_share       — pre-2019 file posts (text + files[], like a normal file message)
// Every other subtype (channel_join/leave, bot_message, …) is skipped.
const IMPORTED_SUBTYPES = new Set(['thread_broadcast', 'file_share'])

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
  const knownIds = new Set(input.users.map((u) => u.id))
  const nameById = new Map(input.users.map((u) => [u.id, displayName(u)]))

  // Every slack id referenced by imported content must be rostered so apply can
  // always resolve it — otherwise ghost authors/reactors (ids absent from
  // users.json) would resolve to undefined and be silently dropped.
  const referenced = new Set<string>()

  const channels = input.channels.map((c) => {
    const memberSlackIds = c.members ?? []
    for (const id of memberSlackIds) referenced.add(id)
    return {
      slackChannelId: c.id,
      name: c.name,
      isPrivate: !!c.is_private,
      topic: c.topic?.value ?? '',
      memberSlackIds,
    }
  })

  const messages: ImportPlan['messages'] = []
  for (const c of input.channels) {
    for (const m of input.messagesByChannel[c.id] ?? []) {
      // Import no-subtype messages plus thread_broadcast/file_share; skip the rest.
      if (m.type !== 'message' || (m.subtype && !IMPORTED_SUBTYPES.has(m.subtype)) || !m.user) continue
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

      referenced.add(m.user)
      for (const r of reactions) for (const id of r.userSlackIds) referenced.add(id)

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

  // Roster: users.json entries first, then a placeholder for every referenced id
  // that users.json never listed (ghost authors/reactors/members).
  const placeholderUsers = input.users.map((u) => ({
    slackId: u.id,
    name: displayName(u),
    email: u.profile?.email ?? `slack-${u.id}@import.invalid`,
  }))
  for (const id of referenced) {
    if (knownIds.has(id)) continue
    placeholderUsers.push({ slackId: id, name: `Unknown (${id})`, email: `slack-${id}@import.invalid` })
  }

  return { placeholderUsers, channels, messages }
}
