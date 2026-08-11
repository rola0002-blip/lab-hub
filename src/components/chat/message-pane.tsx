'use client'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowLeft, Hash, MessageSquare } from 'lucide-react'
import { messageToPlainText } from '@/features/chat/markdown'
import { dayLabel } from '@/lib/humanize'
import { Avatar } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import { useGlobalHotkey } from '@/components/hooks/use-global-hotkey'
import { useMediaQuery } from '@/components/hooks/use-media-query'
import { useChat, dmName } from './chat-store'
import MessageItem, { type Msg } from './message-item'
import { IssueRefProvider } from './issue-ref-store'
import Composer from './composer'
import ThreadPanel from './thread-panel'
import ConversationMenu, { MembersDialog } from './conversation-menu'
import { Skeleton } from '@/components/ui/skeleton'

type Props = {
  conversationId: string
  conversationType: 'CHANNEL' | 'DM'
  channelName: string | null
  topic: string
  archived: boolean
  selfRole: string
  manage: boolean
  memberIds: string[]
  // Deep-link target from `/chat/<cid>?msg=<id>` (search result or a pasted
  // copy-link). Read server-side from searchParams and passed here so a
  // same-conversation soft-navigation still re-triggers the scroll (the pane
  // never remounts). null when there is no `?msg=`.
  deepLinkMsgId?: string | null
}

// How many older pages we'll auto-page back through hunting for a deep-link
// target before giving up (each page is ~50 messages).
const DEEPLINK_MAX_PAGES = 12

// A message is at the bottom of the scroller when it's within this many pixels of
// the end; below the threshold we show the jump-to-latest button.
const AT_BOTTOM_PX = 80

// Pane-level day divider — a sticky pill that rides the top of the scroller as you
// read through a day's messages.
function DayDivider({ label }: { label: string }) {
  return (
    <div className="sticky top-2 z-10 mx-auto my-2 w-fit rounded-full border border-border bg-surface px-3 py-0.5 text-xs font-semibold text-muted shadow-sm">
      {label}
    </div>
  )
}

// Pane-level "New messages" line: a red hairline flanking a "New" label, sitting
// above the first message the viewer hasn't read yet.
function NewMessagesDivider() {
  return (
    <div role="separator" aria-label="New messages" className="my-2 flex items-center gap-2">
      <div className="h-px flex-1 bg-[var(--text-danger)]" />
      <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--text-danger)]">New</span>
      <div className="h-px flex-1 bg-[var(--text-danger)]" />
    </div>
  )
}

export default function MessagePane({ conversationId, conversationType, channelName, topic, archived, selfRole, manage, memberIds, deepLinkMsgId = null }: Props) {
  const { users, online, selfId, registerConversationHandler } = useChat()
  const coarse = useMediaQuery('(pointer: coarse)')
  const [messages, setMessages] = useState<Msg[]>([])
  const [hasMore, setHasMore] = useState(false)
  // Initial-load flag so the pane shows skeleton rows (not a blank intro) until
  // the first fetch resolves, and re-shows them when switching conversations.
  const [loading, setLoading] = useState(true)
  const [threadRoot, setThreadRoot] = useState<string | null>(null)
  const [typing, setTyping] = useState<string | null>(null)
  // The first-unread anchor is captured once per conversation (before markRead)
  // and held in state so the "New" line stays put while you read and only clears
  // on the next visit.
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [newCount, setNewCount] = useState(0)
  // Roving focus (Task 18): the id of the message row that is the single tab stop.
  // null falls back to the newest row, so Tab / ↑-from-composer always lands on
  // the latest message; focusing or arrowing to a row updates it.
  const [activeMsgId, setActiveMsgId] = useState<string | null>(null)
  // Channel-intro "Add people" opens the same members dialog the ⋯ menu uses.
  const [membersOpen, setMembersOpen] = useState(false)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const firstLoad = useRef(true)
  // Which conversation we've already captured a first-unread anchor for (guards
  // the capture-once-before-markRead rule); mirrors atBottom into a ref so the SSE
  // handler can read the live value without re-subscribing.
  const unreadCapturedRef = useRef<string | null>(null)
  const atBottomRef = useRef(true)
  // Live snapshot of id→name so the SSE handler can resolve `<@id>` mentions to
  // readable names when flattening an inbound body for the #live-msgs region,
  // without re-subscribing the handler on every roster change.
  const namesRef = useRef<Map<string, string>>(new Map())
  useEffect(() => { namesRef.current = new Map(users.map((u) => [u.id, u.name])) }, [users])

  const markRead = useCallback(() => void fetch(`/api/chat/conversations/${conversationId}/read`, { method: 'POST' }), [conversationId])

  const loadLatest = useCallback(async () => {
    setLoading(true)
    const r = await fetch(`/api/chat/conversations/${conversationId}/messages`)
    if (!r.ok) { setLoading(false); return }
    const d = await r.json()
    setMessages(d.messages); setHasMore(d.hasMore); setLoading(false)
    // Capture the unread anchor from the FIRST load of this conversation, before
    // markRead advances lastReadAt server-side.
    if (unreadCapturedRef.current !== conversationId) {
      unreadCapturedRef.current = conversationId
      setFirstUnreadId(d.firstUnreadId ?? null)
    }
    markRead()
  }, [conversationId, markRead])

  // loadLatest only setStates after awaiting fetch — async, never a synchronous cascading render.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadLatest() }, [loadLatest])

  // Reset the first-load flag when the conversation changes so the next load opens at newest.
  useEffect(() => { firstLoad.current = true }, [conversationId])

  // Touch dismissal for the focus-revealed message toolbar. A tap focuses the row
  // (tabIndex), which is what reveals its toolbar via group-focus-within — but
  // WebKit/iOS does not blur the focused element when you tap a non-focusable area,
  // so the toolbar would stay open until another row is tapped. Coarse-pointer only
  // (the app's single gesture predicate); on Chromium this merely duplicates the
  // native blur. `[data-msg-id]` marks a message row in BOTH this pane and the
  // thread panel, and the emoji picker's fixed catcher is a DOM descendant of its
  // row — so this never fights an open picker.
  useEffect(() => {
    if (!coarse) return
    const onDoc = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('[data-msg-id]')) return
      const a = document.activeElement as HTMLElement | null
      if (a?.closest?.('[data-msg-id]')) a.blur()
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [coarse])

  const remove = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id))
  }, [])

  const upsert = useCallback((msg: Msg) => {
    // Only root-level messages live in this list. Replies belong to the thread
    // panel; a reply's arrival is handled in the SSE handler (a genuinely new
    // reply bumps the root's replyCount there — edits/reactions/deletes of an
    // existing reply must not touch it), so ignore any reply here.
    if (msg.parentId) return
    setMessages((prev) => {
      // A real message replaces the sender's optimistic temp (matched by author+body).
      if (!msg.id.startsWith('tmp-')) {
        const tmpIdx = prev.findIndex((m) => m.id.startsWith('tmp-') && m.author.id === msg.author.id && m.body === msg.body)
        if (tmpIdx >= 0) prev = [...prev.slice(0, tmpIdx), ...prev.slice(tmpIdx + 1)]
      }
      const i = prev.findIndex((m) => m.id === msg.id)
      if (i >= 0) return [...prev.slice(0, i), msg, ...prev.slice(i + 1)]
      return [...prev, msg]
    })
  }, [])

  // Flag a temp whose POST failed so its row can offer an inline retry.
  const markFailed = useCallback((tempId: string) => {
    setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, sendFailed: true } : m)))
  }, [])

  // Re-POST a failed temp reconstructed from its own row. On success the real
  // message replaces the temp (upsert matches by author+body); on failure it
  // re-flags for another retry.
  const retrySend = useCallback(async (temp: Msg) => {
    setMessages((prev) => prev.map((m) => (m.id === temp.id ? { ...m, sendFailed: false } : m)))
    const payload = {
      conversationId, body: temp.body,
      ...(temp.parentId ? { parentId: temp.parentId } : {}),
      ...(temp.attachments.length ? { attachments: temp.attachments.map((a) => ({ path: a.path, name: a.name, mime: a.mime, size: a.size })) } : {}),
    }
    try {
      const r = await fetch('/api/chat/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const d = await r.json().catch(() => null)
      if (r.status === 201 && d?.message) upsert(d.message)
      else markFailed(temp.id)
    } catch { markFailed(temp.id) }
  }, [conversationId, upsert, markFailed])

  useEffect(() => registerConversationHandler((e) => {
    if (e.t === 'reconnect') { void loadLatest(); return }
    if (!('cid' in e) || e.cid !== conversationId) return
    if (e.t === 'msg' || e.t === 'msg_edit' || e.t === 'msg_del' || e.t === 'rx') {
      const isNew = e.t === 'msg'
      void fetch(`/api/chat/messages/${e.mid}`).then(async (r) => {
        if (!r.ok) return
        const m: Msg = (await r.json()).message
        if (m.parentId) {
          // A reply never appears in the root list. Only a brand-new reply bumps
          // the root's replyCount; edits, reactions and deletes of an existing
          // reply must not inflate it. Then refetch the root so its facepile
          // (replyParticipants + lastReplyAt) reflects the new reply live.
          if (isNew) {
            setMessages((prev) => prev.map((x) => (x.id === m.parentId ? { ...x, replyCount: x.replyCount + 1 } : x)))
            void fetch(`/api/chat/messages/${m.parentId}`).then(async (r2) => { if (r2.ok) upsert((await r2.json()).message) })
          }
          return
        }
        upsert(m); markRead()
        // A genuinely-new inbound message (this handler already filters to the
        // current conversation and this branch drops our own echo + system rows,
        // and backfill never routes through here) is announced to assistive tech
        // via the app-shell #live-msgs region as "{author}: {body}", and — when
        // we're scrolled up — feeds the "N new" pill on the jump button. The
        // visible message list is aria-live="off", so this sr-only region is the
        // SINGLE announcer of the body: there is no double-announcement. We flatten
        // markdown/mention syntax to a readable line and cap very long bodies.
        if (isNew && m.kind !== 'system' && m.author.id !== selfId) {
          const live = document.getElementById('live-msgs')
          if (live) {
            const flat = messageToPlainText(m.body, (id) => namesRef.current.get(id))
            const body = flat.length > 200 ? `${flat.slice(0, 200).trimEnd()}…` : flat
            const p = document.createElement('p')
            // Attachment-only / empty-body messages still announce their arrival.
            p.textContent = body ? `${m.author.name}: ${body}` : `New message from ${m.author.name}`
            live.appendChild(p)
            while (live.childElementCount > 20) live.firstElementChild?.remove()
          }
          if (!atBottomRef.current) setNewCount((n) => n + 1)
        }
      })
    }
    if (e.t === 'typing') {
      setTyping(e.name)
      if (typingTimer.current) clearTimeout(typingTimer.current)
      typingTimer.current = setTimeout(() => setTyping(null), 4000)
    }
  }), [conversationId, registerConversationHandler, loadLatest, upsert, markRead, selfId])

  useEffect(() => { // first load opens at newest; afterwards stick to bottom only when near it
    const el = scroller.current
    if (!el) return
    // On first load, open at newest — UNLESS we're deep-linking, in which case the
    // deep-link effect owns the scroll position (don't yank to bottom first).
    if (firstLoad.current && messages.length) {
      firstLoad.current = false
      if (!deepLinkMsgId) el.scrollTop = el.scrollHeight
      return
    }
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTop = el.scrollHeight
  }, [messages, deepLinkMsgId])

  // Track bottom-proximity for the jump button; only re-render on transitions.
  const onScroll = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_PX
    if (bottom === atBottomRef.current) return
    atBottomRef.current = bottom
    setAtBottom(bottom)
    if (bottom) setNewCount(0)
  }, [])

  const jumpToLatest = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    el.scrollTo({ top: el.scrollHeight, behavior })
    setNewCount(0)
    markRead()
  }, [markRead])

  // Pane-scoped `r` = reply-in-thread on the focused message. useGlobalHotkey
  // already ignores keypresses while an input/textarea is focused; we resolve the
  // focused row via its data-attributes and only open a thread for a root message.
  useGlobalHotkey('r', () => {
    const el = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-msg-id]')
    if (el?.dataset.root === 'true' && el.dataset.msgId) setThreadRoot(el.dataset.msgId)
  })

  // Roving keyboard model for the message log. Focus a row, then ↑/↓/Home/End move
  // focus (and the single tab stop) between rows; Esc returns to the composer.
  const focusComposer = useCallback(() => {
    document.querySelector<HTMLTextAreaElement>('[data-main-composer]')?.focus()
  }, [])
  const focusRow = useCallback((el: HTMLElement | undefined) => {
    if (!el) return
    setActiveMsgId(el.dataset.msgId ?? null)
    el.focus()
    el.scrollIntoView({ block: 'nearest' })
  }, [])
  const onListKeyDown = useCallback((e: React.KeyboardEvent) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-msg-id]')
    if (!row) return
    if (e.key === 'Escape') { e.preventDefault(); focusComposer(); return }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Home' && e.key !== 'End') return
    const rows = Array.from(scroller.current?.querySelectorAll<HTMLElement>('[data-msg-id]') ?? [])
    const i = rows.indexOf(row)
    if (i < 0) return
    e.preventDefault()
    const next = e.key === 'ArrowUp' ? Math.max(0, i - 1)
      : e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1)
      : e.key === 'Home' ? 0 : rows.length - 1
    focusRow(rows[next])
  }, [focusComposer, focusRow])
  // Track the roving tab stop as focus enters a row (Tab, click, or arrow).
  const onListFocus = useCallback((e: React.FocusEvent) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-msg-id]')?.dataset.msgId
    if (id) setActiveMsgId(id)
  }, [])
  // ↑ from the empty composer enters the list at the newest row.
  const enterListAtNewest = useCallback(() => {
    const rows = scroller.current?.querySelectorAll<HTMLElement>('[data-msg-id]')
    focusRow(rows?.[rows.length - 1])
  }, [focusRow])

  const loadEarlier = useCallback(async () => {
    if (!messages.length) return
    const r = await fetch(`/api/chat/conversations/${conversationId}/messages?before=${messages[0].id}`)
    if (!r.ok) return
    const d = await r.json()
    setMessages((prev) => [...d.messages, ...prev]); setHasMore(d.hasMore)
  }, [conversationId, messages])

  // Deep-link: land ON the `?msg=` target. If it isn't loaded yet, page older
  // history (bounded) until it is — this effect re-runs as `messages` grows —
  // then centre it and flash the mention tint (~1.5s). `deepLinkRef` tracks the
  // current target so we scroll once per link and re-arm on a new target
  // (including a same-conversation soft-navigation, since the pane never
  // remounts). No synchronous setState here: pagination goes through
  // loadEarlier (async), and the flash is a transient CSS class, not React state.
  const deepLinkRef = useRef<{ id: string | null; tries: number; done: boolean }>({ id: null, tries: 0, done: false })
  useEffect(() => {
    if (!deepLinkMsgId) return
    const st = deepLinkRef.current
    if (st.id !== deepLinkMsgId) { st.id = deepLinkMsgId; st.tries = 0; st.done = false }
    if (st.done || loading) return
    const el = scroller.current?.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(deepLinkMsgId)}"]`)
    if (el) {
      st.done = true
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
      el.classList.add('msg-flash')
      setTimeout(() => el.classList.remove('msg-flash'), 1500)
      return
    }
    // Target not in the loaded window yet — page back until found or exhausted.
    if (hasMore && st.tries < DEEPLINK_MAX_PAGES) { st.tries++; void loadEarlier() }
  }, [deepLinkMsgId, messages, hasMore, loading, loadEarlier])

  // DM headers show the person, not a generic label: their avatar + name (via
  // dmName, which also handles group DMs) + a live presence line. The peer is the
  // first member that isn't me, resolved against the shared user list.
  const isDm = conversationType === 'DM'
  const peerId = isDm ? memberIds.find((id) => id !== selfId) : undefined
  const peer = peerId ? users.find((u) => u.id === peerId) : undefined
  const peerOnline = peerId ? online.has(peerId) : false
  const dmTitle = dmName({ memberIds }, users, selfId)
  const title = isDm ? dmTitle : `#${channelName}`
  const names = new Map(users.map((u) => [u.id, u.name]))
  const now = new Date() // viewer-local reference for day-divider labels (client render)
  // Exactly one row is a tab stop: the active row, or the newest message when
  // nothing is active yet (or the active row scrolled out of the loaded window).
  const rovingId = (activeMsgId && messages.some((m) => m.id === activeMsgId))
    ? activeMsgId
    : [...messages].reverse().find((m) => m.kind !== 'system')?.id ?? null

  return (
    // `relative` anchors the thread panel's 768–1279 overlay form; it has no effect
    // on the xl in-row column (which is statically positioned).
    <div className="relative flex h-full min-w-0 flex-1">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-4 py-2">
          {/* Narrow (<768): the conversation-list rail collapses (list/pane swap),
              so the pane gets a back affordance to return to the list at /chat. */}
          <Link href="/chat" aria-label="Back to conversations"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-default md:hidden">
            <ArrowLeft size={18} aria-hidden />
          </Link>
          {isDm && peerId && (
            <Avatar size={24} name={dmTitle} id={peerId} image={peer?.image ?? null} presence={peerOnline ? 'active' : 'away'} />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-semibold leading-tight">{title}</h1>
            {isDm
              ? <p className="truncate text-xs text-muted">{peerOnline ? 'Active' : 'Away'}</p>
              : topic && <p className="truncate text-xs text-muted">{topic}</p>}
          </div>
          <ConversationMenu conversationId={conversationId} conversationType={conversationType}
            channelName={channelName} archived={archived} manage={manage} />
        </header>
        <div ref={scroller} onScroll={onScroll} onKeyDown={onListKeyDown} onFocus={onListFocus}
          role="log" aria-label="Messages" aria-live="off"
          className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          {/* Initial load shows skeleton rows instead of a blank/flash of the wrong
              intro; it clears as soon as the first fetch resolves. */}
          {loading && <MessageListSkeleton />}
          {/* Top of history: once there's nothing earlier to load, show the intro —
              the DM peer greeting or the channel welcome — instead of "Load earlier". */}
          {!loading && (hasMore ? (
            <button onClick={loadEarlier} className="mx-auto my-2 block rounded-md border border-border px-3 py-1 text-xs text-muted">Load earlier</button>
          ) : isDm ? (
            <DmIntro peerId={peerId} name={dmTitle} image={peer?.image ?? null} />
          ) : (
            <ChannelIntro name={channelName} manage={manage} onAddPeople={() => setMembersOpen(true)} />
          ))}
          {/* One batched resolution per visible message set — ONE fetch per pane,
              never one per pill. Provides the resolved-ref Map each MessageItem reads. */}
          {!loading && (
          <IssueRefProvider bodies={messages.map((m) => m.body)}>
          {messages.map((m, i) => {
            const prev = messages[i - 1]
            const prevDate = prev ? new Date(prev.createdAt) : null
            const dayChanged = !prevDate || new Date(m.createdAt).toDateString() !== prevDate.toDateString()
            // System rows (created/joined) render as a centered muted line — no
            // avatar, no toolbar, no reactions, never grouped or leading.
            if (m.kind === 'system') {
              return (
                <Fragment key={m.id}>
                  {dayChanged && <DayDivider label={dayLabel(m.createdAt, now)} />}
                  <p className="mx-auto my-1 text-center text-xs italic text-muted">{m.body}</p>
                </Fragment>
              )
            }
            const isFirstUnread = m.id === firstUnreadId
            // Group only against a preceding USER message; a system row breaks the
            // run so the next real message renders leading (avatar + name).
            const groupPrev = prev && prev.kind !== 'system' ? prev : undefined
            return (
              <Fragment key={m.id}>
                {dayChanged && <DayDivider label={dayLabel(m.createdAt, now)} />}
                {isFirstUnread && <NewMessagesDivider />}
                <MessageItem msg={m} prev={groupPrev} names={names} selfId={selfId} selfRole={selfRole}
                  tabIndex={m.id === rovingId ? 0 : -1}
                  forceLeading={isFirstUnread} onUpdated={upsert} onOpenThread={() => setThreadRoot(m.id)} onRetry={retrySend} />
              </Fragment>
            )
          })}
          </IssueRefProvider>
          )}
          {typing && <TypingIndicator name={typing} />}
        </div>
        {!atBottom && (
          <button type="button" onClick={jumpToLatest}
            aria-label={newCount > 0 ? `Jump to ${newCount} new message${newCount === 1 ? '' : 's'}` : 'Jump to latest messages'}
            className="absolute bottom-20 right-6 flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-sm text-accent-on shadow-lg">
            <ArrowDown size={16} aria-hidden />
            {newCount > 0 ? `${newCount} new` : 'Jump to latest'}
          </button>
        )}
        {archived
          ? <p className="border-t border-border p-3 text-sm text-muted">This conversation is archived.</p>
          : <Composer main onNavigateUp={enterListAtNewest} conversationId={conversationId} selfRole={selfRole} memberIds={memberIds} onSent={upsert} onRemove={remove} onFail={markFailed} />}
      </div>
      {threadRoot && (
        <ThreadPanel rootId={threadRoot} conversationId={conversationId} conversationType={conversationType} channelName={channelName}
          names={names} memberIds={memberIds} selfId={selfId} selfRole={selfRole} onClose={() => setThreadRoot(null)} />
      )}
      {membersOpen && (
        <MembersDialog conversationId={conversationId} channelName={channelName} manage={manage} onClose={() => setMembersOpen(false)} />
      )}
    </div>
  )
}

// Initial-load placeholder: a handful of avatar + two-line rows that mirror the
// message layout so the pane has shape while the first fetch is in flight.
function MessageListSkeleton() {
  return (
    <div className="space-y-4 py-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} avatar lines={2} className="px-4" />
      ))}
    </div>
  )
}

// Channel intro at the top of history: a warm welcome + one next step (managers
// get "Add people"). Reuses the shared EmptyState shell (Hash icon).
function ChannelIntro({ name, manage, onAddPeople }: { name: string | null; manage: boolean; onAddPeople: () => void }) {
  return (
    <EmptyState
      icon={Hash}
      title={`Welcome to #${name}`}
      hint={`This is the very beginning of the #${name} channel.`}
      action={manage
        ? (
          <button type="button" onClick={onAddPeople}
            className="mt-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on transition-colors hover:bg-accent-hover">
            Add people
          </button>
        )
        : undefined}
    />
  )
}

// DM intro: the peer's 48px avatar (or a fallback glyph for a group DM with no
// single peer) above a one-line greeting.
function DmIntro({ peerId, name, image }: { peerId?: string; name: string; image: string | null }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      {peerId
        ? <Avatar name={name} id={peerId} image={image} size={48} />
        : <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-active text-muted"><MessageSquare size={22} aria-hidden /></span>}
      <p className="max-w-sm text-sm text-muted">
        This is the start of your conversation with <span className="font-semibold text-default">{name}</span>. Say hi 👋
      </p>
    </div>
  )
}

// "{name} is typing" with three staggered dots. The dots are decorative
// (aria-hidden) and only animate under motion-safe; the text is visual-only and
// deliberately kept out of any live region so it is never announced.
function TypingIndicator({ name }: { name: string }) {
  return (
    <p className="flex items-center gap-1 px-4 py-1 text-xs italic text-subtle">
      <span>{name} is typing</span>
      <span aria-hidden className="ml-0.5 inline-flex items-end gap-0.5">
        <span className="h-1 w-1 rounded-full bg-current motion-safe:animate-typing-dot" />
        <span className="h-1 w-1 rounded-full bg-current motion-safe:animate-typing-dot [animation-delay:150ms]" />
        <span className="h-1 w-1 rounded-full bg-current motion-safe:animate-typing-dot [animation-delay:300ms]" />
      </span>
    </p>
  )
}
