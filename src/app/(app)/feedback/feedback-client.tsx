'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Megaphone } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Menu } from '@/components/ui/menu'
import { EmptyState } from '@/components/ui/empty-state'
import { toast } from '@/lib/toast-store'
import { formatDateTime } from '@/lib/time'
import {
  canDeleteFeedback, canReviewFeedback, FEEDBACK_STATUSES, type FeedbackStatus,
} from '@/features/feedback/feedback-policy'
// TYPE-ONLY: feedback-service.ts is `server-only`, so a value import here would
// fail the build. The DTO shape is all the client needs.
import type { FeedbackDto } from '@/features/feedback/feedback-service'
import type { Role } from '@/lib/session'
import { setFeedbackStatusAction, deleteFeedbackAction } from './actions'

// Existing Badge variants only — no new tokens, nothing to add to `npm run contrast`.
// The WORD is always rendered beside the colour, so status/type is never colour-alone
// (the SP8 --health-* rule, applied to chips).
const STATUS_VARIANT: Record<FeedbackStatus, 'success' | 'warning' | 'neutral'> = {
  NEW: 'warning', REVIEWED: 'neutral', PLANNED: 'success', DONE: 'success', DECLINED: 'neutral',
}
const TYPE_VARIANT = { BUG: 'danger', IDEA: 'neutral' } as const
const TYPE_WORD = { BUG: 'Bug', IDEA: 'Idea' } as const
// 'PLANNED' → 'Planned'. Derived, so a sixth status needs no copy edit here.
const word = (s: string): string => s.charAt(0) + s.slice(1).toLowerCase()

const EMPTY_TITLE = 'No feedback yet'
const EMPTY_HINT = 'Found a bug or have an idea? The button is in the sidebar.'

const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'
// Content-sized Menu trigger (the primitive's default is a 28px icon button).
const TRIGGER = `inline-flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-hover active:bg-active ${RING}`
const SMALL_BTN = `rounded-md border border-border px-2 py-1 text-xs hover:bg-hover active:bg-active ${RING}`

type Me = { id: string; role: Role }

// Hoisted (never created during render — react-hooks/static-components).
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button" aria-pressed={on} onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${RING} ${on
        ? 'border-[var(--border-focus)] bg-selected text-[var(--text-accent)]'
        : 'border-border text-muted hover:bg-hover hover:text-default active:bg-active'}`}
    >{children}</button>
  )
}

function FeedbackCard({ item, tz, showAuthor, mayReview, mayDelete }: {
  item: FeedbackDto; tz: string; showAuthor: boolean; mayReview: boolean; mayDelete: boolean
}) {
  const router = useRouter()
  const [confirmDel, setConfirmDel] = useState(false)
  // The delete gets its OWN transition (the issue-detail.tsx idiom) so `pending`
  // disables the confirm without touching the status writes above it.
  const [pending, startDel] = useTransition()
  const [, startStatus] = useTransition()
  // No optimistic state: every mutation lands via router.refresh() (the Files posture).
  const chip = <Badge variant={STATUS_VARIANT[item.status]}>{word(item.status)}</Badge>
  const who = showAuthor ? ` from ${item.author.name}` : ''
  // appVersion/pagePath/userAgent are TEXT, never an href: pagePath is client-captured
  // and only normalized to start with '/', so '//host/path' survives — linking it would
  // be an open redirect. Same for userAgent.
  const context = `v${item.appVersion} · ${item.pagePath} · ${item.userAgent}`

  function setStatus(status: FeedbackStatus) {
    startStatus(async () => {
      const r = await setFeedbackStatusAction(item.id, status)
      if (r.ok) router.refresh(); else toast(r.message)
    })
  }
  function del() {
    startDel(async () => {
      const r = await deleteFeedbackAction(item.id)
      if (r.ok) router.refresh(); else { setConfirmDel(false); toast(r.message) }
    })
  }

  return (
    <li className="rounded-xl border border-border bg-surface p-3 shadow-xs">
      <div className="flex flex-wrap items-center gap-2">
        {showAuthor && (
          <>
            <Avatar name={item.author.name} id={item.author.id} image={item.author.image} size={24} />
            <span className="text-sm font-medium text-default">{item.author.name}</span>
          </>
        )}
        <Badge variant={TYPE_VARIANT[item.type]}>{TYPE_WORD[item.type]}</Badge>
        {mayReview ? (
          // The chip beside this trigger is the row's ONLY rendering of its status, and
          // it lives INSIDE the button — so the accessible name must speak the status
          // too, or a screen-reader user hears no current value at all. The e2e/a11y
          // locators match this name as a SUBSTRING, so the prefix must not change.
          <Menu
            label={`Change status of feedback${who} — currently ${word(item.status)}`} buttonClassName={TRIGGER}
            button={<>{chip}<ChevronDown size={14} className="text-subtle" aria-hidden /></>}
            items={FEEDBACK_STATUSES.map((s) => ({ label: word(s), onSelect: () => setStatus(s), disabled: s === item.status }))}
          />
        ) : chip}
        <time dateTime={item.createdAt} className="ml-auto text-xs text-subtle">{formatDateTime(new Date(item.createdAt), tz)}</time>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-default">{item.body}</p>
      <p className="mt-2 truncate text-xs text-muted" title={context}>{context}</p>
      {item.screenshotPath && (
        // The p-0.5 is what makes the house hover/active fill visible: with no padding
        // the image covers the anchor's whole box and the state paints nowhere.
        <a href={item.screenshotPath} target="_blank" rel="noreferrer"
          className={`mt-2 inline-block rounded-md p-0.5 transition-colors hover:bg-hover active:bg-active ${RING}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- uploads are served by our own route */}
          <img src={item.screenshotPath} alt={`Screenshot attached to this feedback${who}`}
            className="h-16 w-16 rounded-md border border-border object-cover" />
        </a>
      )}
      {mayDelete && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {confirmDel ? (
            <>
              <span className="text-xs text-muted">Delete this permanently?</span>
              {/* autoFocus: the trigger that raised this confirm has just unmounted, so
                  without it focus falls to the document body and the keyboard path
                  is stranded mid-task. */}
              <button type="button" onClick={del} disabled={pending} autoFocus
                className={`${SMALL_BTN} font-medium text-[var(--text-danger)] disabled:opacity-50`}>Delete</button>
              <button type="button" onClick={() => setConfirmDel(false)} className={`${SMALL_BTN} text-default`}>Cancel</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmDel(true)} aria-label={`Delete feedback${who}`}
              className={`${SMALL_BTN} text-muted hover:text-default`}>Delete</button>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * The /feedback body (spec §9.2). Admins get the review queue first and their own
 * items below it; everyone else gets "My feedback" alone. `all` is undefined for
 * non-admins — the page never fetches it for them.
 */
export function FeedbackClient({ user, mine, all, tz }: {
  user: Me; mine: FeedbackDto[]; all?: FeedbackDto[]; tz: string
}) {
  const [status, setStatus] = useState<'ALL' | FeedbackStatus>('NEW')
  const [type, setType] = useState<'ALL' | 'BUG' | 'IDEA'>('ALL')
  // Cosmetic gate reading the SAME predicate the service asserts.
  const queue = canReviewFeedback(user.role) ? all : undefined
  const filtered = (queue ?? []).filter(
    (f) => (status === 'ALL' || f.status === status) && (type === 'ALL' || f.type === type),
  )

  const myList = mine.length > 0 ? (
    <ul className="mt-3 space-y-3">
      {mine.map((f) => (
        <FeedbackCard key={f.id} item={f} tz={tz} showAuthor={false} mayReview={false}
          mayDelete={canDeleteFeedback(user, { authorId: f.author.id, status: f.status })} />
      ))}
    </ul>
  ) : null

  // The queue is a superset of "my feedback", so an empty queue means an empty page:
  // one empty state, not two identical ones stacked.
  if (queue && queue.length === 0) return <div className="mt-4"><EmptyState icon={Megaphone} title={EMPTY_TITLE} hint={EMPTY_HINT} /></div>

  return (
    <div className="mt-4 space-y-8">
      {queue && (
        <section>
          <h2 className="text-sm font-semibold text-muted">Review queue</h2>
          {/* Pure client-side filtering — the whole queue is already in hand. `New` is
              the default, so a just-triaged item leaves the visible queue immediately. */}
          <div className="mt-2 space-y-1.5">
            <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
              <Chip on={status === 'ALL'} onClick={() => setStatus('ALL')}>All</Chip>
              {FEEDBACK_STATUSES.map((s) => <Chip key={s} on={status === s} onClick={() => setStatus(s)}>{word(s)}</Chip>)}
            </div>
            <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-1.5">
              <Chip on={type === 'ALL'} onClick={() => setType('ALL')}>All</Chip>
              <Chip on={type === 'BUG'} onClick={() => setType('BUG')}>Bugs</Chip>
              <Chip on={type === 'IDEA'} onClick={() => setType('IDEA')}>Ideas</Chip>
            </div>
          </div>
          {filtered.length > 0 ? (
            <ul className="mt-3 space-y-3">
              {filtered.map((f) => (
                <FeedbackCard key={f.id} item={f} tz={tz} showAuthor mayReview
                  mayDelete={canDeleteFeedback(user, { authorId: f.author.id, status: f.status })} />
              ))}
            </ul>
          ) : (
            // An empty SLICE is the filter's own result — saying "No feedback yet"
            // above a non-empty queue would be a lie (the /projects precedent).
            <EmptyState icon={Megaphone} title="No feedback matches these filters" hint="Try another status or type." />
          )}
        </section>
      )}
      <section>
        <h2 className="text-sm font-semibold text-muted">My feedback</h2>
        {myList ?? (queue
          ? <p className="mt-3 text-sm text-muted">You haven&apos;t sent any feedback yet.</p>
          : <EmptyState icon={Megaphone} title={EMPTY_TITLE} hint={EMPTY_HINT} />)}
      </section>
    </div>
  )
}
