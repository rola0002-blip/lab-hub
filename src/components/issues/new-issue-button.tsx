'use client'
import { Plus } from 'lucide-react'
import { openIssueComposer } from '@/lib/issue-composer-store'
export function NewIssueButton() {
  return (
    <button type="button" onClick={() => openIssueComposer()} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
      <Plus size={15} aria-hidden />New issue
    </button>
  )
}
