// Shared "new issue" composer store. Framework-agnostic external store (no React
// import — lint-safe): any surface can call openIssueComposer(prefill) to raise
// the create-issue modal pre-filled (e.g. a project page seeding its projectId,
// or "create issue from message" seeding title/originMessageId). T13 mounts the
// modal that reads this via useSyncExternalStore; T14 opens it from chat.
type Prefill = { title?: string; description?: string; projectId?: string | null; originMessageId?: string | null }
type State = { open: boolean; prefill: Prefill }
let state: State = { open: false, prefill: {} }
const listeners = new Set<() => void>()
function emit() { for (const l of listeners) l() }

export function openIssueComposer(prefill: Prefill = {}) { state = { open: true, prefill }; emit() }
export function closeIssueComposer() { state = { open: false, prefill: {} }; emit() }
export function subscribeIssueComposer(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb) }
export function getIssueComposer(): State { return state }
