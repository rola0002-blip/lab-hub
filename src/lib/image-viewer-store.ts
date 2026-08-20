// Shared image-viewer store (wave-7). Framework-agnostic external store cloned
// from feedback-composer-store.ts (no React import — lint-safe): any surface can
// call openImageViewer({ name, path }) to raise the globally-mounted
// <ImageViewerDialog />, which reads this via useSyncExternalStore.
//
// WHY a global store and not per-row state: chat rows REMOUNT when the
// optimistic temp (id tmp-…) is replaced by the server message (the pane keys
// rows by message id). A lightbox opened on the temp row vanished mid-view the
// instant the real message landed. The store lives outside React, so the viewer
// survives the swap — and works from the thread panel and the pinned popover
// for free, one dialog app-wide.
type State = { open: boolean; name: string; path: string }
const CLOSED: State = { open: false, name: '', path: '' }
let state: State = CLOSED
const listeners = new Set<() => void>()
function emit() { for (const l of listeners) l() }

export function openImageViewer(v: { name: string; path: string }) { state = { open: true, ...v }; emit() }
export function closeImageViewer() { state = CLOSED; emit() }
export function subscribeImageViewer(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb) }
export function getImageViewer(): State { return state }
