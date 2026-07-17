// User ids are opaque (better-auth / cuid / UUID), so the token body must accept
// the full id-safe alphabet — letters, digits, hyphen, underscore — not just [a-z0-9].
const USER_TOKEN = /<@([a-zA-Z0-9_-]+)>/g
const CHANNEL_TOKEN = '<!channel>'

export function parseMentions(body: string): { userIds: string[]; channel: boolean } {
  const userIds = [...new Set([...body.matchAll(USER_TOKEN)].map((m) => m[1]))]
  return { userIds, channel: body.includes(CHANNEL_TOKEN) }
}

export function renderBody(body: string, names: Map<string, string>): string {
  return body
    .replaceAll(CHANNEL_TOKEN, '@channel')
    .replace(USER_TOKEN, (_, id: string) => `@${names.get(id) ?? 'unknown'}`)
}

// The LabHub bot must never @-mention anyone (spec §5.4), but its posts
// interpolate user-controlled text (issue titles, project/document/user names)
// that may contain literal mention tokens. The bot send path runs its body
// through this so parseMentions/resolveMentions can no longer match — while the
// text stays readable: <!channel> → #channel, <@id> → @id. Co-located with the
// token definitions so the neutralizer and the parser can never drift apart.
// Robust against nesting: the replacement outputs contain no '<', and '@'/'#' are
// outside the id alphabet, so no residual or reconstructed token can survive
// (see mentions.test.ts for the adversarial cases).
export function neutralizeMentions(body: string): string {
  return body
    .replaceAll(CHANNEL_TOKEN, '#channel')
    .replace(USER_TOKEN, (_, id: string) => `@${id}`)
}
