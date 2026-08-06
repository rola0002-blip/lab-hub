// Shared "give feedback" composer store (v0.13). Framework-agnostic external
// store cloned from issue-composer-store.ts (no React import — lint-safe): any
// surface can call openFeedbackComposer(pagePath) to raise the globally-mounted
// <FeedbackDialog />, which reads this via useSyncExternalStore.
//
// The page path is an EXPLICIT argument rather than read from `window` in here:
// every call site is already a client component that knows its own location, and
// keeping the store window-free leaves it pure and unit-testable. Callers pass
// `window.location.pathname + window.location.search` — the page the user was
// actually on when they reached for the button. Spec §9.1: the capture happens at
// OPEN time, so it stays put even if the user navigates with the dialog open.
//
// Unlike the issue composer there is NO guest gate anywhere on this path —
// feedback is open to every signed-in role (spec §1).
type State = { open: boolean; pagePath: string }
const CLOSED: State = { open: false, pagePath: '' }
let state: State = CLOSED
const listeners = new Set<() => void>()
function emit() { for (const l of listeners) l() }

export function openFeedbackComposer(pagePath: string) { state = { open: true, pagePath }; emit() }
export function closeFeedbackComposer() { state = CLOSED; emit() }
export function subscribeFeedbackComposer(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb) }
export function getFeedbackComposer(): State { return state }
