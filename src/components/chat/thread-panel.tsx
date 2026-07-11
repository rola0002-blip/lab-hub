'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useChat } from './chat-store'
import MessageItem, { type Msg } from './message-item'
import Composer from './composer'
import { useFocusTrap } from '@/components/hooks/use-focus-trap'
import { useMediaQuery } from '@/components/hooks/use-media-query'

type Props = {
  rootId: string
  conversationId: string
  conversationType: 'CHANNEL' | 'DM'
  channelName: string | null
  names: Map<string, string>
  memberIds: string[]
  selfId: string
  selfRole: string
  onClose: () => void
}

export default function ThreadPanel({ rootId, conversationId, conversationType, channelName, names, memberIds, selfId, selfRole, onClose }: Props) {
  const { registerConversationHandler } = useChat()
  const [root, setRoot] = useState<Msg | null>(null)
  const [replies, setReplies] = useState<Msg[]>([])
  // Responsive form. <768: modal drawer (focus-trapped, backdrop, inert behind).
  // 768–1279: overlay pinned over the message pane. ≥1280: in-row third column
  // (unchanged). matchMedia gates the trap + inert so they engage ONLY as a drawer.
  const narrow = useMediaQuery('(max-width: 767px)')
  const drawerRef = useRef<HTMLElement>(null)
  useFocusTrap(drawerRef, narrow)

  const load = useCallback(async () => {
    const r = await fetch(`/api/chat/threads/${rootId}`)
    if (!r.ok) return
    const d = await r.json()
    setRoot(d.root); setReplies(d.replies)
  }, [rootId])

  // load() only setStates after awaiting fetch — async, never a synchronous cascading render.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const removeReply = useCallback((id: string) => {
    setReplies((prev) => prev.filter((x) => x.id !== id))
  }, [])

  const upsertReply = useCallback((m: Msg) => {
    if (m.id === rootId) { setRoot(m); return } // edits/reactions land on the root
    setReplies((prev) => {
      // A real reply replaces the sender's optimistic temp (matched by author+body).
      if (!m.id.startsWith('tmp-')) {
        const t = prev.findIndex((x) => x.id.startsWith('tmp-') && x.author.id === m.author.id && x.body === m.body)
        if (t >= 0) prev = [...prev.slice(0, t), ...prev.slice(t + 1)]
      }
      const i = prev.findIndex((x) => x.id === m.id)
      if (i >= 0) return [...prev.slice(0, i), m, ...prev.slice(i + 1)]
      return [...prev, m]
    })
  }, [rootId])

  useEffect(() => registerConversationHandler((e) => {
    if (e.t === 'reconnect') { void load(); return } // refetch replies missed during an SSE outage
    if (!('cid' in e) || e.cid !== conversationId) return
    if (e.t === 'msg' || e.t === 'msg_edit' || e.t === 'msg_del' || e.t === 'rx') {
      void fetch(`/api/chat/messages/${e.mid}`).then(async (r) => {
        if (!r.ok) return
        const m: Msg = (await r.json()).message
        if (m.id === rootId || m.parentId === rootId) upsertReply(m)
      })
    }
  }), [conversationId, rootId, registerConversationHandler, upsertReply, load])

  // Escape closes the panel (matches the ✕ button); mirrors the booking-dialog convention.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Drawer form only (<768): mark the rest of the shell (#app-content: top bar +
  // main) inert so nothing behind the trapped drawer is reachable by pointer or
  // AT. The drawer itself is portaled to <body> (outside #app-content), so inert
  // never disables it. Guarded on `narrow`, so the overlay/column forms pay nothing.
  useEffect(() => {
    if (!narrow) return
    const content = document.getElementById('app-content')
    content?.setAttribute('inert', '')
    return () => content?.removeAttribute('inert')
  }, [narrow])

  // Identical panel body across all three forms; only the wrapper's positioning /
  // modality changes with the viewport.
  const body = (
    <>
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">Thread</h2>
        <button onClick={onClose} aria-label="Close thread" className="rounded p-1 text-muted hover:bg-hover">✕</button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {root && (
          // Reuse MessageItem for the root (identical rendering, reactions, edit,
          // ⋯ menu) — `inThread` drops the redundant facepile + "reply in thread".
          <div className="border-b border-border py-1">
            <MessageItem msg={root} names={names} selfId={selfId} selfRole={selfRole}
              onUpdated={upsertReply} onOpenThread={() => {}} inThread />
            <p className="px-4 pb-2 pt-1 text-xs font-medium text-subtle">{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</p>
          </div>
        )}

        <div className="px-1 py-2">
          {replies.map((m, i) => (
            <MessageItem key={m.id} msg={m} prev={replies[i - 1]} names={names} selfId={selfId} selfRole={selfRole}
              onUpdated={upsertReply} onOpenThread={() => {}} />
          ))}
        </div>
      </div>

      <Composer conversationId={conversationId} selfRole={selfRole} memberIds={memberIds} parentId={rootId}
        onSent={upsertReply} onRemove={removeReply}
        showBroadcast={conversationType === 'CHANNEL'} broadcastLabel={channelName ? `#${channelName}` : undefined} />
    </>
  )

  // <768: focus-trapped modal drawer over a backdrop, portaled to <body> so the
  // inert #app-content behind it stays fully inert (the drawer is not a descendant
  // of it). Backdrop click + Esc close; useFocusTrap restores focus to the opener.
  if (narrow) {
    return createPortal(
      <div className="fixed inset-0 z-50 md:hidden">
        <button type="button" aria-hidden tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/50" />
        <aside ref={drawerRef} role="dialog" aria-modal="true" aria-label="Thread"
          className="absolute inset-y-0 right-0 flex w-full max-w-[26rem] flex-col border-l border-border bg-surface shadow-modal outline-none">
          {body}
        </aside>
      </div>,
      document.body,
    )
  }

  // 768–1279: absolute overlay pinned to the right of the (now relative) pane row.
  // ≥1280 (xl): reverts to the in-row static third column — byte-identical to before
  // (static, w-26rem, shrink-0, transparent, no shadow).
  return (
    <aside aria-label="Thread" data-region-root tabIndex={-1}
      className="absolute inset-y-0 right-0 z-30 flex w-[22rem] flex-col border-l border-border bg-surface shadow-modal outline-none xl:static xl:z-auto xl:w-[26rem] xl:shrink-0 xl:bg-transparent xl:shadow-none">
      {body}
    </aside>
  )
}
