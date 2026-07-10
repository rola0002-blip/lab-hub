'use client'
import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import { useFocusTrap } from '@/components/hooks/use-focus-trap'
import { IconButton } from './icon-button'

export function Modal({ title, onClose, wide = false, children }: {
  title: string; onClose: () => void; wide?: boolean; children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const labelId = useId()
  useFocusTrap(ref, true)
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelId}
        className={`max-h-[85vh] w-full ${wide ? 'max-w-2xl' : 'max-w-md'} overflow-y-auto rounded-xl bg-surface p-5 shadow-modal`}>
        <div className="mb-3 flex items-center justify-between">
          <h2 id={labelId} className="text-lg font-semibold text-default">{title}</h2>
          <IconButton label="Close" onClick={onClose}><X size={16} /></IconButton>
        </div>
        {children}
      </div>
    </div>
  )
}
