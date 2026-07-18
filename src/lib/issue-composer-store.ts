// Shared "new issue" composer store. Framework-agnostic external store (no React
// import — lint-safe): any surface can call openIssueComposer(prefill) to raise
// the create-issue modal pre-filled (e.g. a project page seeding its projectId,
// or "create issue from message" seeding title/originMessageId). T13 mounts the
// modal that reads this via useSyncExternalStore; T14 opens it from chat.
//
// `assignToSelf` is the quick-capture intent flag (v0.9.5): the `c` shortcut, the
// ⌘K "Create issue" command, and create-from-chat set it so the composer opens
// pre-filled with the current user as assignee. The "New issue" buttons leave it
// unset (assignee stays empty). It is only a DEFAULT — the picker stays editable.
// The store carries the intent, not the id, so the resolution to the actual
// current-user id happens where that id is known (the globally-mounted modal).
type Prefill = { title?: string; description?: string; projectId?: string | null; originMessageId?: string | null; assignToSelf?: boolean }
type State = { open: boolean; prefill: Prefill }
let state: State = { open: false, prefill: {} }
const listeners = new Set<() => void>()
function emit() { for (const l of listeners) l() }

export function openIssueComposer(prefill: Prefill = {}) { state = { open: true, prefill }; emit() }
export function closeIssueComposer() { state = { open: false, prefill: {} }; emit() }
export function subscribeIssueComposer(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb) }
export function getIssueComposer(): State { return state }

// Pure resolver for the composer's initial assignee: quick-capture (assignToSelf)
// defaults to the current user; every other open path starts unassigned. Extracted
// so the rule is unit-testable without rendering the modal.
export function resolveInitialAssignee(prefill: Prefill, currentUserId: string): string | null {
  return prefill.assignToSelf ? currentUserId : null
}
