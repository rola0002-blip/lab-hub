// Pure and CLIENT-SAFE — deliberately no `server-only`, so the sidebar (a client
// component) can import it, exactly as conversation-list.tsx:6 imports ./sort.
//
// The sidebar total and the rail's per-row badge must agree, so both skip muted
// rows: a muted conversation contributes 0 (conversation-list.tsx:55-56, and the
// rule stated at :26-28). A mention in a muted conversation still surfaces via the
// rail's mention badge (:53-54) and the bell — this sum is unread MESSAGES only.
export function sumUnread(items: { unread: number; muted: boolean }[]): number {
  return items.reduce((n, c) => (c.muted ? n : n + c.unread), 0)
}
