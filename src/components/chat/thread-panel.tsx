'use client'
import { useCallback, useEffect, useState } from 'react'
import { useChat } from './chat-store'
import MessageItem, { renderTokens, type Msg } from './message-item'
import Composer from './composer'

type Props = {
  rootId: string
  conversationId: string
  names: Map<string, string>
  selfId: string
  selfRole: string
  onClose: () => void
}

export default function ThreadPanel({ rootId, conversationId, names, selfId, selfRole, onClose }: Props) {
  const { registerConversationHandler } = useChat()
  const [root, setRoot] = useState<Msg | null>(null)
  const [replies, setReplies] = useState<Msg[]>([])

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

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-gray-200">
      <header className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
        <h2 className="text-sm font-semibold">Thread</h2>
        <button onClick={onClose} aria-label="Close thread" className="rounded p-1 text-gray-500 hover:bg-gray-100">✕</button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {root && (
          <div className="border-b border-gray-200 p-3">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-gray-900">{root.author.name}</span>
              <time className="text-[11px] text-gray-400">{new Date(root.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
            </div>
            {root.deleted ? (
              <p className="text-sm italic text-gray-400">message deleted</p>
            ) : (
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-gray-800">
                {renderTokens(root.body, names)}
                {root.editedAt && <span className="ml-1 text-[11px] text-gray-400">(edited)</span>}
              </p>
            )}
            {!root.deleted && root.attachments.map((a) => (
              a.mime.startsWith('image/')
                ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={a.id} src={a.path} alt={a.name} className="mt-1 max-h-48 rounded-lg border border-gray-200" />
                ) : (
                  <a key={a.id} href={a.path} target="_blank" rel="noreferrer" download={a.name}
                    className="mt-1 flex w-fit items-center gap-2 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">
                    <span>📄</span><span className="max-w-[10rem] truncate">{a.name}</span>
                  </a>
                )
            ))}
            <p className="mt-2 text-xs font-medium text-gray-400">{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</p>
          </div>
        )}

        <div className="px-1 py-2">
          {replies.map((m, i) => (
            <MessageItem key={m.id} msg={m} prev={replies[i - 1]} names={names} selfId={selfId} selfRole={selfRole}
              onUpdated={upsertReply} onOpenThread={() => {}} />
          ))}
        </div>
      </div>

      <Composer conversationId={conversationId} selfRole={selfRole} parentId={rootId} onSent={upsertReply} onRemove={removeReply} />
    </aside>
  )
}
