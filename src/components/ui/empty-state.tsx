import type { LucideIcon } from 'lucide-react'

export function EmptyState({ icon: Icon, title, hint, action }: {
  icon: LucideIcon; title: string; hint: string; action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-active text-muted"><Icon size={22} aria-hidden /></span>
      <p className="text-md font-semibold text-default">{title}</p>
      <p className="max-w-sm text-sm text-muted">{hint}</p>
      {action}
    </div>
  )
}
