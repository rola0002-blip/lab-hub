import type { ReactNode } from 'react'

// The standard page header (v0.32 Task 11): `eyebrow` names the SIDEBAR SECTION
// the page lives under (Workspace / Projects / Lab / Directory / Admin), `title`
// is the h1, and `description` / `actions` are optional slots. Replaces the
// per-page ad-hoc markup — including the stale "02 —" numbered eyebrows that
// never matched the sidebar's actual sections. No hooks: usable from server
// components as-is.
export function PageHeader({ eyebrow, title, description, actions }: {
  eyebrow?: string
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="text-sm font-medium text-subtle">{eyebrow}</p>}
        <h1 className="mt-1 text-2xl font-semibold text-default">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
    </div>
  )
}
