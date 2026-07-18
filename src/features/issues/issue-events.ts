import type { ClientEvent } from '@/components/use-events'

// Single source of truth for "should an issue surface (list / board / detail)
// refetch on this SSE frame?". The three views re-render from server truth on any
// issue mutation — and, exactly like every chat surface (chat-store, message-pane,
// thread-panel, bell), must ALSO re-sync on a `reconnect` sentinel, since events
// emitted while the stream was down were missed. Consolidating the predicate keeps
// the three views from drifting again (the bug this fixes: reconnect was handled in
// chat but silently omitted from all three issue views).
export function isIssueRefetchEvent(e: ClientEvent): boolean {
  return e.t === 'issue' || e.t === 'issue_move' || e.t === 'issue_comment' || e.t === 'reconnect'
}
