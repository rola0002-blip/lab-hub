'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Bell as BellIcon, BellPlus, Check, Hash, AtSign, MessageSquare,
  CalendarClock, CalendarCheck, CalendarX, UserPlus, CircleCheck, type LucideIcon,
} from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import { humanTime } from '@/lib/humanize'
import { notificationHref } from '@/lib/notification-href'
import { usePushOptIn } from './hooks/use-push-optin'
import { useChat } from './chat/chat-store'
import { useEvents } from './use-events'

type Item = { id: string; type: string; payload: Record<string, string>; readAt: string | null; createdAt: string }

const LABEL: Record<string, string> = {
  booking_pending: 'Booking needs approval',
  booking_decided: 'Booking decision',
  booking_cancelled_maintenance: 'Booking cancelled (maintenance)',
  booking_reminder: 'Upcoming booking',
  booking_expired: 'Booking request expired',
  booking_cancelled: 'Booking cancelled',
  message_mention: 'You were mentioned',
  message_dm: 'New direct message',
  channel_added: 'Added to a channel',
  issue_assigned: 'Issue assigned to you',
  issue_mention: 'You were mentioned on an issue',
  issue_comment: 'New comment on an issue',
  issue_done: 'Your issue was completed',
}

// Per-type glyph for the actor square when there's no person avatar to show
// (booking events, and chat events whose conversation resolves to a channel).
const TYPE_ICON: Record<string, LucideIcon> = {
  booking_pending: CalendarClock,
  booking_decided: CalendarCheck,
  booking_cancelled_maintenance: CalendarX,
  booking_reminder: CalendarClock,
  booking_expired: CalendarX,
  booking_cancelled: CalendarX,
  message_mention: AtSign,
  message_dm: MessageSquare,
  channel_added: Hash,
  issue_assigned: UserPlus,
  issue_mention: AtSign,
  issue_comment: MessageSquare,
  issue_done: CircleCheck,
}

type Face =
  | { kind: 'user'; id: string; name: string; image: string | null }
  | { kind: 'glyph'; icon: LucideIcon }

// Collapse consecutive notifications about the SAME conversation into one group
// (they share one actor face). Items arrive newest-first; a run only merges when
// both rows carry the same defined conversationId, so booking notifications (no
// conversation) each stand alone.
function groupItems(items: Item[]): { key: string; items: Item[] }[] {
  const groups: { key: string; items: Item[] }[] = []
  for (const it of items) {
    const cid = it.payload?.conversationId
    const last = groups[groups.length - 1]
    if (cid && last && last.items[0].payload?.conversationId === cid) last.items.push(it)
    else groups.push({ key: it.id, items: [it] })
  }
  return groups
}

export default function Bell() {
  const { conversations, users, selfId } = useChat()
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState<Item[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const now = new Date() // viewer-local reference for humanized notification times
  const push = usePushOptIn() // desktop-push opt-in lives in this tray, not a separate top-bar icon

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/notifications')
      if (!r.ok) return
      const d = await r.json()
      setUnread(d.unread); setItems(d.items)
    } catch { /* transient network error; next poll retries */ }
  }, [])

  useEffect(() => {
    // Fetch-on-mount: load() is async and only setStates after an awaited network
    // round-trip, so it can't cause the synchronous cascading render this rule guards against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    const t = setInterval(load, 30_000) // spec: 30 s polling
    return () => clearInterval(t)
  }, [load])

  useEvents((e) => { if (e.t === 'notif' || e.t === 'reconnect') void load() })

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && unread > 0) {
      const ids = items.filter((i) => !i.readAt).map((i) => i.id)
      await fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
      setUnread(0)
    }
  }

  // Resolve the actor face: a DM's peer shows their avatar; a channel shows its
  // hash; everything else falls back to a per-type glyph square.
  function faceFor(item: Item): Face {
    const cid = item.payload?.conversationId
    const conv = cid ? conversations.find((c) => c.id === cid) : undefined
    if (conv?.type === 'DM') {
      const peerId = conv.memberIds.find((id) => id !== selfId)
      if (peerId) {
        const peer = users.find((u) => u.id === peerId)
        return { kind: 'user', id: peerId, name: peer?.name ?? 'Someone', image: peer?.image ?? null }
      }
    }
    if (conv?.type === 'CHANNEL') return { kind: 'glyph', icon: Hash }
    return { kind: 'glyph', icon: TYPE_ICON[item.type] ?? BellIcon }
  }

  const groups = groupItems(items)

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle} aria-label="Notifications" className="relative rounded-full p-2 text-muted transition-colors hover:bg-hover hover:text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
        <BellIcon size={20} aria-hidden />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-on">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 max-h-[70vh] w-80 overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-menu">
          <p className="px-2 pb-1 pt-0.5 text-xs font-semibold uppercase tracking-wide text-subtle">Notifications</p>
          {groups.length === 0 ? (
            <EmptyState icon={Check} title="You're all caught up."
              hint="New mentions, messages and booking updates will show up here." />
          ) : groups.map((g) => {
            const head = g.items[0]
            const face = faceFor(head)
            const unreadGroup = g.items.some((it) => !it.readAt)
            // Every notification type resolves to its target: issue → /issues/<id>,
            // DM/mention/channel → the conversation (deep-linked to the message when
            // known), booking → its bookings/approvals page. Grouping only merges
            // same-conversation rows, so the head is representative of the group.
            const href = notificationHref(head)
            const inner = (
              <>
                <FaceAvatar face={face} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={`truncate text-sm ${unreadGroup ? 'font-semibold text-default' : 'text-muted'}`}>{LABEL[head.type] ?? head.type}</p>
                    <time className="shrink-0 text-2xs text-subtle">{humanTime(head.createdAt, now)}</time>
                  </div>
                  {g.items.map((it) => (
                    typeof it.payload?.message === 'string'
                      ? <p key={it.id} className="mt-0.5 line-clamp-2 text-xs text-muted">{it.payload.message}</p>
                      : null
                  ))}
                </div>
              </>
            )
            return href ? (
              // Close the tray on navigate — the outside-click guard skips in-panel
              // clicks, so without this the panel would sit on top of the target page.
              <Link key={g.key} href={href} onClick={() => setOpen(false)} className="flex gap-2.5 rounded-lg p-2 transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">{inner}</Link>
            ) : (
              <div key={g.key} className="flex gap-2.5 rounded-lg p-2 transition-colors hover:bg-hover">{inner}</div>
            )
          })}
          {push.show && (
            // Desktop-push opt-in — shown only while this device isn't subscribed
            // (usePushOptIn), pinned to the tray's foot. A successful subscribe flips
            // push.show off and the row disappears.
            <div className="mt-1 border-t border-border pt-1">
              <button type="button" onClick={() => void push.enable()} disabled={push.busy}
                className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-avatar)] bg-active text-muted">
                  <BellPlus size={18} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-default">Enable desktop notifications</span>
                  <span className="block text-xs text-subtle">Get alerted even when this tab is closed.</span>
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Actor square: a real 36px avatar for a person, else a matching rounded-square
// glyph. Never a circle — same avatar radius as the rest of the app.
function FaceAvatar({ face }: { face: Face }) {
  if (face.kind === 'user') return <Avatar size={36} name={face.name} id={face.id} image={face.image} />
  const Icon = face.icon
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-avatar)] bg-active text-muted">
      <Icon size={18} aria-hidden />
    </span>
  )
}
