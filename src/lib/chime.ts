// Which bell rows chime: chat-shaped notifications only (F7). The notif SSE
// event carries no type, so the client diffs fetched items against a watermark.
export const CHIME_TYPES = new Set(['message_mention', 'message_dm', 'message_thread_reply'])
export type ChimeItem = { id: string; type: string; createdAt: string }

// Returns the advanced watermark + whether to chime. First run (null watermark)
// initializes WITHOUT chiming — opening the app must not ding.
export function shouldChime(watermark: string | null, items: ChimeItem[]): { chime: boolean; watermark: string } {
  let max = watermark
  let chime = false
  for (const it of items) {
    if (it.createdAt > (max ?? '')) {
      max = it.createdAt
      if (watermark !== null && CHIME_TYPES.has(it.type)) chime = true
    }
  }
  return { chime, watermark: max ?? '' }
}
