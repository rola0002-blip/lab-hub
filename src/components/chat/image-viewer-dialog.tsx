'use client'
import { useEffect, useId, useRef, useSyncExternalStore } from 'react'
import { X } from 'lucide-react'
import { useFocusTrap } from '@/components/hooks/use-focus-trap'
import { subscribeImageViewer, getImageViewer, closeImageViewer } from '@/lib/image-viewer-store'

// Wave-7: full-size viewer for inline chat images (Slack-style click-to-zoom).
// The timeline caps attachments at max-h-64 — legible thumbnails, not readable
// figures; this dialog is where "view the content after sending" happens. It is
// the Modal posture (focus trap, Escape, backdrop close) minus the card chrome:
// a dark backdrop and the image at natural size, viewport-capped.
//
// Globally mounted (see image-viewer-store for why the state is external): one
// dialog app-wide, raised by message rows anywhere (timeline, thread panel,
// pinned popover), returning null when closed so each open starts fresh.
export function ImageViewerDialog() {
  const store = useSyncExternalStore(subscribeImageViewer, getImageViewer, getImageViewer)
  if (!store.open) return null
  return <Viewer name={store.name} path={store.path} />
}

function Viewer({ name, path }: { name: string; path: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const labelId = useId()
  useFocusTrap(ref, true)
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { e.stopPropagation(); closeImageViewer() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeImageViewer() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelId}
        className="flex max-w-full flex-col items-center gap-3">
        <div className="flex w-full items-center justify-between gap-4">
          <h2 id={labelId} className="truncate text-sm font-medium text-white/90">{name}</h2>
          {/* Plain button, not IconButton: the shared primitive's text-muted /
              hover-bg-hover tokens are tuned for a surface card and go low-contrast
              on the near-black backdrop. */}
          <button type="button" onClick={closeImageViewer} aria-label="Close" title="Close"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/90 transition-colors hover:bg-white/10 hover:text-white">
            <X size={16} aria-hidden />
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={path} alt={name} className="max-h-[80vh] max-w-[90vw] rounded-lg object-contain shadow-modal" />
      </div>
    </div>
  )
}
