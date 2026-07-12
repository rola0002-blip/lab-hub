'use client'
import { usePathname } from 'next/navigation'
import { useGlobalHotkey } from '@/components/hooks/use-global-hotkey'
import { openIssueComposer } from '@/lib/issue-composer-store'
import type { Role } from '@/lib/session'

export function IssueHotkeys({ role }: { role: Role }) {
  const pathname = usePathname()
  const inProjects = pathname.startsWith('/issues') || pathname.startsWith('/projects')
  useGlobalHotkey('c', () => { if (role !== 'guest' && inProjects) openIssueComposer() })
  return null
}
