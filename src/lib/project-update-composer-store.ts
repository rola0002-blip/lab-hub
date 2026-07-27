// Shared "post project update" composer store — the issue-composer-store shape:
// framework-agnostic external store (no React import — lint-safe); the modal reads
// it via useSyncExternalStore. Raised from a project page (seeding projectId) or
// from a chat message's "Post as project update" (seeding body + originMessageId).
// The modal is mounted once in the (app) layout, so any surface can open it.
type Prefill = { projectId?: string; body?: string; originMessageId?: string | null }
type State = { open: boolean; prefill: Prefill }
let state: State = { open: false, prefill: {} }
const listeners = new Set<() => void>()
function emit() { for (const l of listeners) l() }

export function openProjectUpdateComposer(prefill: Prefill = {}) { state = { open: true, prefill }; emit() }
export function closeProjectUpdateComposer() { state = { open: false, prefill: {} }; emit() }
export function subscribeProjectUpdateComposer(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb) }
export function getProjectUpdateComposer(): State { return state }
