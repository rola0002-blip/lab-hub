'use client'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, Hash, MessageSquare } from 'lucide-react'
import { dayLabel } from '@/lib/humanize'
import { Avatar } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import { useGlobalHotkey } from '@/components/hooks/use-global-hotkey'
import { useChat, dmName } from './chat-store'
import MessageItem, { type Msg } from './message-item'
import Composer from './composer'
import ThreadPanel from './thread-panel'
import ConversationMenu, { MembersDialog } from './conversation-menu'
import SearchBox from './search-box'

type Props = {
  conversationId: string
  conversationType: 'CHANNEL' | 'DM'
  channelName: string | null
  topic: string
  archived: boolean
  selfRole: string
  manage: boolean
  memberIds: string[]
}

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
    <div role="separator" aria-label="New messages" tabIndex={-1} className="my-2 flex items-center gap-2">
      <div className="h-px flex-1 bg-[var(--color-danger)]" />
      <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-danger)]">New</span>
      <div className="h-px flex-1 bg-[var(--color-danger)]" />
    </div>
  )
}

export default function MessagePane({ conversationId, conversationType, channelName, topic, archived, selfRole, manage, memberIds }: Props) {
  const { users, online, selfId, registerConversationHandler } = useChat()
  const [messages, setMessages] = useState<Msg[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [threadRoot, setThreadRoot] = useState<string | null>(null)
  const [typing, setTyping] = useState<string | null>(null)
  // The first-unread anchor is captured once per conversation (before markRead)
  // and held in state so the "New" line stays put while you read and only clears
  // on the next visit.
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [newCount, setNewCount] = useState(0)
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

  const markRead = useCallback(() => void fetch(`/api/chat/conversations/${conversationId}/read`, { method: 'POST' }), [conversationId])

  const loadLatest = useCallback(async () => {
    const r = await fetch(`/api/chat/conversations/${conversationId}/messages`)
    if (!r.ok) return
    const d = await r.json()
    setMessages(d.messages); setHasMore(d.hasMore)
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
        // A new message from someone else that lands while we're scrolled up feeds
        // the "N new" pill on the jump button. System rows (created/joined lines)
        // never contribute to the unread pill.
        if (isNew && m.kind !== 'system' && m.author.id !== selfId && !atBottomRef.current) setNewCount((n) => n + 1)
      })
    }
    if (e.t === 'typing') {
      setTyping(e.name)
      if (typingTimer.current) clearTimeout(typingTimer.current)
      typingTimer.current = setTimeout(() => setTyping(null), 4000)
    }
  }), [conversationId, registerConversationHandler, loadLatest, upsert, markRead, selfId])

  useEffect(() => { // first load opens at newest unconditionally; afterwards stick to bottom only when near it
    const el = scroller.current
    if (!el) return
    if (firstLoad.current && messages.length) { el.scrollTop = el.scrollHeight; firstLoad.current = false; return }
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTop = el.scrollHeight
  }, [messages])

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

  async function loadEarlier() {
    if (!messages.length) return
    const r = await fetch(`/api/chat/conversations/${conversationId}/messages?before=${messages[0].id}`)
    if (!r.ok) return
    const d = await r.json()
    setMessages((prev) => [...d.messages, ...prev]); setHasMore(d.hasMore)
  }

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

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-4 py-2">
          {isDm && peerId && (
            <Avatar size={24} name={dmTitle} id={peerId} image={peer?.image ?? null} presence={peerOnline ? 'active' : 'away'} />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-semibold leading-tight">{title}</h1>
            {isDm
              ? <p className="truncate text-xs text-muted">{peerOnline ? 'Active' : 'Away'}</p>
              : topic && <p className="truncate text-xs text-muted">{topic}</p>}
          </div>
          <SearchBox />
          <ConversationMenu conversationId={conversationId} conversationType={conversationType}
            channelName={channelName} archived={archived} manage={manage} />
        </header>
        <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          {/* Top of history: once there's nothing earlier to load, show the intro —
              the DM peer greeting or the channel welcome — instead of "Load earlier". */}
          {hasMore ? (
            <button onClick={loadEarlier} className="mx-auto my-2 block rounded-md border border-border px-3 py-1 text-xs text-muted">Load earlier</button>
          ) : isDm ? (
            <DmIntro peerId={peerId} name={dmTitle} image={peer?.image ?? null} />
          ) : (
            <ChannelIntro name={channelName} manage={manage} onAddPeople={() => setMembersOpen(true)} />
          )}
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
                  forceLeading={isFirstUnread} onUpdated={upsert} onOpenThread={() => setThreadRoot(m.id)} onRetry={retrySend} />
              </Fragment>
            )
          })}
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
          : <Composer conversationId={conversationId} selfRole={selfRole} memberIds={memberIds} onSent={upsert} onRemove={remove} onFail={markFailed} />}
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
