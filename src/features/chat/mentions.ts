const USER_TOKEN = /<@([a-z0-9]+)>/g
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
