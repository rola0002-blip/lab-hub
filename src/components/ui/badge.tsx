const CHIP = {
  success: 'bg-[#eaf6ef] text-[#00583f] dark:bg-[#0d2b21] dark:text-[#57c99a]',
  warning: 'bg-[#fdf3d5] text-[#8a6d10] dark:bg-[#3a3320] dark:text-[#e8d9a0]',
  danger:  'bg-[#fdeaf0] text-[#a3184a] dark:bg-[#3a1622] dark:text-[#f291b5]',
  neutral: 'bg-active text-muted',
} as const

export function Badge({ count, variant, children }: {
  count?: number; variant?: keyof typeof CHIP; children?: React.ReactNode
}) {
  if (typeof count === 'number') {
    if (count <= 0) return null
    return <span className="ml-auto rounded-full bg-[var(--sidebar-badge,#e01e5a)] px-1.5 text-2xs font-semibold leading-4 text-white tabular-nums">{count > 99 ? '99+' : count}</span>
  }
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${CHIP[variant ?? 'neutral']}`}>{children}</span>
}
