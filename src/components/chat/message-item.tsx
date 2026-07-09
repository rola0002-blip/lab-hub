'use client'
import { Fragment, useState, type ReactNode } from 'react'

// Client-side mirror of the server MessageDto (message-service is `server-only`,
// so we redeclare the shape here rather than import it into a client bundle).
export type Msg = {
  id: string
  conversationId: string
  parentId: string | null
  author: { id: string; name: string }
  body: string
  deleted: boolean
  editedAt: string | null
  createdAt: string
  replyCount: number
  reactions: { emoji: string; userIds: string[] }[]
  attachments: { id: string; path: string; name: string; mime: string; size: number }[]
  mentionUserIds: string[]
  mentionsChannel: boolean
}

type Names = Map<string, string>

// Curated reaction set surfaced in the hover emoji picker.
export const EMOJIS = ['👍', '🙏', '😂', '🎉', '✅', '❌', '👀', '🔥', '💯', '🤔', '😮', '❤️']

// Mention tokens carry opaque user ids (cuid/uuid → letters, digits, `-`, `_`),
// so the split charset matches mentions.ts USER_TOKEN, not a narrow [a-z0-9].
const TOKEN = /(<@[a-zA-Z0-9_-]+>|<!channel>)/g
const USER_TOKEN = /^<@([a-zA-Z0-9_-]+)>$/
const URL_RE = /(https?:\/\/[^\s]+)/g

// Build the message body as React nodes — mentions and links become elements,
// everything else stays a plain string (React auto-escapes; never dangerouslySetInnerHTML).
export function renderTokens(body: string, names: Names): ReactNode[] {
  const out: ReactNode[] = []
  let k = 0
  for (const part of body.split(TOKEN)) {
    if (!part) continue
    if (part === '<!channel>') {
      out.push(<span key={k++} className="rounded bg-accent/10 px-0.5 font-medium text-accent">@channel</span>)
      continue
    }
    const m = USER_TOKEN.exec(part)
    if (m) {
      out.push(<span key={k++} className="rounded bg-accent/10 px-0.5 font-medium text-accent">@{names.get(m[1]) ?? 'unknown'}</span>)
      continue
    }
    for (const seg of part.split(URL_RE)) {
      if (!seg) continue
      if (/^https?:\/\//.test(seg)) out.push(<a key={k++} href={seg} target="_blank" rel="noreferrer" className="text-accent underline">{seg}</a>)
      else out.push(<Fragment key={k++}>{seg}</Fragment>)
    }
  }
  return out
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

type Props = {
  msg: Msg
  prev?: Msg
  names: Names
  selfId: string
  selfRole: string
  onUpdated: (m: Msg) => void
  onOpenThread: () => void
}

export default function MessageItem({ msg, prev, names, selfId, selfRole, onUpdated, onOpenThread }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(msg.body)
  const [showPicker, setShowPicker] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [busy, setBusy] = useState(false)

  const own = msg.author.id === selfId
  const canDelete = own || selfRole === 'admin'
  const isTemp = msg.id.startsWith('tmp-')

  const cur = new Date(msg.createdAt)
  const prevDate = prev ? new Date(prev.createdAt) : null
  const newDay = !prevDate || cur.toDateString() !== prevDate.toDateString()
  const grouped = !!prev && !newDay && prev.author.id === msg.author.id && cur.getTime() - prevDate!.getTime() < 5 * 60 * 1000

  async function refresh() {
    const r = await fetch(`/api/chat/messages/${msg.id}`)
    if (r.ok) onUpdated((await r.json()).message)
  }
  async function react(emoji: string) {
    setShowPicker(false)
    await fetch(`/api/chat/messages/${msg.id}/reactions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emoji }),
    })
    await refresh()
  }
  async function saveEdit() {
    const body = draft.trim()
    if (!body) return
    setBusy(true)
    const r = await fetch(`/api/chat/messages/${msg.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
    })
    setBusy(false)
    if (r.ok) { setEditing(false); await refresh() }
  }
  async function del() {
    setBusy(true)
    const r = await fetch(`/api/chat/messages/${msg.id}`, { method: 'DELETE' })
    setBusy(false)
    if (r.ok) { setConfirmDel(false); await refresh() }
  }

  const tbBtn = 'rounded px-1 text-sm leading-none hover:bg-gray-100'

  return (
    <>
      {newDay && (
        <div className="my-3 flex items-center gap-2 text-[11px] font-medium text-gray-400">
          <hr className="flex-1 border-gray-200" />
          <span>{cur.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
          <hr className="flex-1 border-gray-200" />
        </div>
      )}
      <div className={`group relative rounded px-2 hover:bg-gray-50 ${grouped ? 'py-0' : 'pt-1.5'}`}>
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-gray-900">{msg.author.name}</span>
            <time className="text-[11px] text-gray-400">{fmtTime(msg.createdAt)}</time>
          </div>
        )}

        {editing ? (
          <div className="mt-0.5">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus rows={2}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(false)
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void saveEdit() }
              }}
              className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm" />
            <div className="mt-1 flex items-center gap-2 text-xs">
              <button onClick={saveEdit} disabled={busy} className="rounded bg-accent px-2 py-0.5 font-medium text-white disabled:opacity-50">Save</button>
              <button onClick={() => setEditing(false)} className="rounded border border-gray-300 px-2 py-0.5">Cancel</button>
              <span className="text-gray-400">Enter to save · Esc to cancel</span>
            </div>
          </div>
        ) : msg.deleted ? (
          <p className="text-sm italic text-gray-400">message deleted</p>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm text-gray-800">
            {renderTokens(msg.body, names)}
            {msg.editedAt && <span className="ml-1 text-[11px] text-gray-400">(edited)</span>}
          </p>
        )}

        {!msg.deleted && !editing && msg.attachments.map((a) => (
          a.mime.startsWith('image/')
            ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={a.id} src={a.path} alt={a.name} className="mt-1 max-h-64 rounded-lg border border-gray-200" />
            ) : (
              <a key={a.id} href={a.path} target="_blank" rel="noreferrer" download={a.name}
                className="mt-1 flex w-fit items-center gap-2 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">
                <span>📄</span><span className="max-w-xs truncate">{a.name}</span>
                <span className="text-gray-400">{Math.max(1, Math.round(a.size / 1024))} KB</span>
              </a>
            )
        ))}

        {!msg.deleted && msg.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {msg.reactions.map((rx) => {
              const mine = rx.userIds.includes(selfId)
              return (
                <button key={rx.emoji} onClick={() => react(rx.emoji)}
                  className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs ${mine ? 'border-accent bg-accent/10 text-accent' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  <span>{rx.emoji}</span><span>{rx.userIds.length}</span>
                </button>
              )
            })}
          </div>
        )}

        {!msg.parentId && msg.replyCount > 0 && (
          <button onClick={onOpenThread} className="mt-1 text-xs font-medium text-accent hover:underline">
            {msg.replyCount} {msg.replyCount === 1 ? 'reply' : 'replies'}
          </button>
        )}

        {!msg.deleted && !isTemp && !editing && (
          <div className="absolute -top-3 right-2 z-10 hidden items-center gap-0.5 rounded-md border border-gray-200 bg-white px-1 py-0.5 shadow-sm group-hover:flex">
            <button title="React 👍" onClick={() => react('👍')} className={tbBtn}>👍</button>
            <div className="relative">
              <button title="Add reaction" onClick={() => setShowPicker((v) => !v)} className={tbBtn}>😊</button>
              {showPicker && (
                <div className="absolute right-0 top-6 z-20 flex w-40 flex-wrap gap-1 rounded-md border border-gray-200 bg-white p-1 shadow-md">
                  {EMOJIS.map((e) => (
                    <button key={e} onClick={() => react(e)} className="rounded px-1 py-0.5 text-base hover:bg-gray-100">{e}</button>
                  ))}
                </div>
              )}
            </div>
            {!msg.parentId && <button title="Reply in thread" onClick={onOpenThread} className={tbBtn}>💬</button>}
            {own && <button title="Edit" onClick={() => { setDraft(msg.body); setEditing(true) }} className={tbBtn}>✏️</button>}
            {canDelete && <button title="Delete" onClick={() => setConfirmDel(true)} className={tbBtn}>🗑️</button>}
          </div>
        )}

        {confirmDel && (
          <div className="absolute right-2 top-5 z-20 flex items-center gap-2 rounded-md border border-red-200 bg-white px-2 py-1 text-xs shadow-md">
            <span className="text-gray-600">Delete message?</span>
            <button onClick={del} disabled={busy} className="rounded bg-red-600 px-2 py-0.5 font-medium text-white disabled:opacity-50">Delete</button>
            <button onClick={() => setConfirmDel(false)} className="rounded border border-gray-300 px-2 py-0.5">Cancel</button>
          </div>
        )}
      </div>
    </>
  )
}
