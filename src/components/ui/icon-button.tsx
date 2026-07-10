'use client'
export function IconButton({ label, onClick, active = false, disabled = false, children }: {
  label: string; onClick?: () => void; active?: boolean; disabled?: boolean; children: React.ReactNode
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-100 ${
        disabled
          ? 'cursor-not-allowed text-subtle opacity-40'
          : active ? 'bg-active text-default' : 'text-muted hover:bg-hover hover:text-default'
      }`}>
      {children}
    </button>
  )
}
