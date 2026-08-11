import Link from 'next/link'
import { Files } from 'lucide-react'
import { formatDateTime } from '@/lib/time'
import { EmptyState } from '@/components/ui/empty-state'
import type { DocumentDto } from '@/features/documents/document-service'

// The lab's own copy of the files-client helper (files-client.tsx:24). That module is
// 'use client', so a server component cannot import from it — one shared formatter
// would have to become a third module for three lines.
function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

// v0.15 §5.3 — the linked folder's contents, read-only for EVERY role (browse and
// download are open to guests by documents-policy). Rendered only when the project
// HAS a folder: with none, the composer's "Files folder" select is the affordance,
// so an unlinked project shows no placeholder at all. SERVER component — no state,
// no action; the link out is the whole interaction.
export function ProjectFiles({ folder, docs, timezone }: {
  folder: { id: string; name: string }; docs: DocumentDto[]; timezone: string
}) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-surface p-4 shadow-xs">
      <h2 className="font-medium text-default">Files in {folder.name}</h2>
      {docs.length === 0 ? (
        <EmptyState icon={Files} title="No files in this folder yet" hint="Files uploaded to this folder appear here." />
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-hover">
              {/* pdf/image open inline, office files download — the serving route
                  sets Content-Disposition, so one anchor covers both. */}
              <a href={d.path} target="_blank" rel="noreferrer"
                className="min-w-0 flex-1 truncate py-1 text-default hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">{d.name}</a>
              {/* Same responsive gates as the dashboard's Recent files card: the
                  narrow viewport keeps the filename and drops the metadata. */}
              <span className="hidden w-16 shrink-0 text-right tabular-nums text-subtle sm:block">{fmtSize(d.size)}</span>
              <span className="hidden w-40 shrink-0 truncate text-muted md:block">{d.uploaderName}</span>
              <span className="hidden w-44 shrink-0 truncate text-subtle lg:block">{formatDateTime(d.createdAt, timezone)}</span>
            </li>
          ))}
        </ul>
      )}
      <Link href={`/files?folder=${folder.id}`} className="mt-3 block text-sm text-[var(--text-accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">Open in Files →</Link>
    </section>
  )
}
