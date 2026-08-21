// Which bell rows chime: chat-shaped notifications only (F7). The notif SSE
// event carries no type, so the client diffs fetched items against a watermark.
export const CHIME_TYPES = new Set(['message_mention', 'message_dm', 'message_thread_reply'])
export type ChimeItem = { id: string; type: string; createdAt: string }

// Returns the advanced watermark, whether to chime, and the rows that triggered
// it (`hits`, in batch order — the poll delivers newest-first). First run (null
// watermark) initializes WITHOUT chiming — opening the app must not ding.
// `hits` feeds the desktop-shell notification bridge (SP11): the toast must
// surface exactly the rows the chime did, so it rides the same decision.
export function shouldChime(watermark: string | null, items: ChimeItem[]): { chime: boolean; watermark: string; hits: ChimeItem[] } {
  let max = watermark
  const hits: ChimeItem[] = []
  for (const it of items) {
    // Chime candidates compare against the ORIGINAL watermark (a newer
    // non-chat row in the same batch must not shadow them); the watermark
    // itself advances past everything seen.
    if (watermark !== null && it.createdAt > watermark && CHIME_TYPES.has(it.type)) hits.push(it)
    if (it.createdAt > (max ?? '')) max = it.createdAt
  }
  return { chime: hits.length > 0, watermark: max ?? '', hits }
}
