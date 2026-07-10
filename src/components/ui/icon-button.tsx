'use client'
export function IconButton({ label, onClick, active = false, children }: {
  label: string; onClick?: () => void; active?: boolean; children: React.ReactNode
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-100 ${
        active ? 'bg-active text-default' : 'text-muted hover:bg-hover hover:text-default'
      }`}>
      {children}
    </button>
  )
}
