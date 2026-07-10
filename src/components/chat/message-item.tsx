'use client'
import { Fragment, useState, type ReactNode } from 'react'
import { Copy, Check } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { avatarHue } from '@/lib/avatar'
import { humanTime, clockTime } from '@/lib/humanize'
import { tokenizeMessage, type Token } from '@/features/chat/markdown'

// Client-side mirror of the server MessageDto (message-service is `server-only`,
// so we redeclare the shape here rather than import it into a client bundle).
export type Msg = {
  id: string
  conversationId: string
  parentId: string | null
  author: { id: string; name: string; image: string | null }
  body: string
  deleted: boolean
  editedAt: string | null
  createdAt: string
  replyCount: number
  reactions: { emoji: string; userIds: string[] }[]
  attachments: { id: string; path: string; name: string; mime: string; size: number }[]
  mentionUserIds: string[]
  mentionsChannel: boolean
  // Client-only optimistic marker: set on a temp (`tmp-`) message whose POST
  // failed, so the row can surface an inline "Not delivered · Retry". Never sent
  // by the server; absent/false on every persisted message.
  sendFailed?: boolean
}

type Names = Map<string, string>

// Curated reaction set surfaced in the hover emoji picker.
export const EMOJIS = ['👍', '🙏', '😂', '🎉', '✅', '❌', '👀', '🔥', '💯', '🤔', '😮', '❤️']

// Fenced code renders as a scroll-safe block with a copy button. A block-display
// <span> (not <pre>/<div>) keeps the code valid inside the message <p> wrapper.
function CodeBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="relative my-1 block">
      <span className="block overflow-x-auto whitespace-pre rounded-md bg-surface-sunken p-2 pr-9 font-mono text-[13px]">{value}</span>
      <button
        type="button" aria-label="Copy code" title="Copy code"
        onClick={() => { void navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200) }}
        className="absolute right-1.5 top-1.5 rounded p-1 text-subtle hover:bg-hover hover:text-default"
      >
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      </button>
    </span>
  )
}

// Render one markdown token to a React node (never an HTML string). `jumbo`
// enlarges an emoji-only body; `selfId` emphasizes a mention of the viewer.
function renderToken(t: Token, key: number, names: Names, selfId: string | undefined, jumbo: boolean): ReactNode {
  switch (t.type) {
    case 'bold': return <strong key={key} className="font-semibold text-default">{t.value}</strong>
    case 'italic': return <em key={key}>{t.value}</em>
    case 'strike': return <s key={key}>{t.value}</s>
    case 'code': return <code key={key} className="rounded bg-surface-sunken px-1 font-mono text-[13px]">{t.value}</code>
    case 'codeblock': return <CodeBlock key={key} value={t.value} />
    case 'quote': return <span key={key} className="my-0.5 block border-l-2 border-border pl-2 text-muted">{t.value}</span>
    case 'listitem': return <span key={key} className="block pl-1">• {t.value}</span>
    case 'link': return <a key={key} href={t.value} target="_blank" rel="noreferrer" className="text-link underline">{t.value}</a>
    case 'channel': return <span key={key} className="rounded bg-accent-subtle px-1 font-medium text-accent">@channel</span>
    case 'mention': {
      const isSelf = !!selfId && t.userId === selfId
      return (
        <span key={key} className={`rounded px-1 font-medium text-accent ${isSelf ? 'bg-mention' : 'bg-accent-subtle'}`}>
          @{names.get(t.userId ?? t.value) ?? 'unknown'}
        </span>
      )
    }
    case 'emoji': return <span key={key} className={jumbo ? 'align-middle text-3xl leading-none' : undefined}>{t.value}</span>
    default: return <Fragment key={key}>{t.value}</Fragment>
  }
}

// Build the message body as React nodes. Subsumes the old mention/URL renderer
// (mentions + links render identically) and adds markdown, code, quotes, lists
// and emoji — all via tokens, never dangerouslySetInnerHTML. A body of ≤3 emoji
// with no real text renders "jumbo".
export function renderTokens(body: string, names: Names, selfId?: string): ReactNode[] {
  const tokens = tokenizeMessage(body)
  const meaningful = tokens.filter((t) => !(t.type === 'text' && t.value.trim() === ''))
  const jumbo = meaningful.length > 0 && meaningful.length <= 3 && meaningful.every((t) => t.type === 'emoji')
  return tokens.map((t, k) => renderToken(t, k, names, selfId, jumbo))
}

type Props = {
  msg: Msg
  prev?: Msg
  names: Names
  selfId: string
  selfRole: string
  onUpdated: (m: Msg) => void
  onOpenThread: () => void
  // Task 9 (unread) passes this to force a leading (un-grouped) row for the
  // first-unread message. Defaults false; grouping is otherwise automatic.
  forceLeading?: boolean
  // Task 9 (optimistic send): re-POST a failed temp message. Only wired for the
  // main pane; the thread panel leaves it undefined (temps drop on failure there).
  onRetry?: (m: Msg) => void
}

export default function MessageItem({ msg, prev, names, selfId, selfRole, onUpdated, onOpenThread, forceLeading = false, onRetry }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(msg.body)
  const [showPicker, setShowPicker] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [busy, setBusy] = useState(false)

  const own = msg.author.id === selfId
  const canDelete = own || selfRole === 'admin'
  const isTemp = msg.id.startsWith('tmp-')
  // A live message that @-mentions the viewer tints its row (accent rail + wash).
  const selfMention = !msg.deleted && msg.mentionUserIds.includes(selfId)

  const now = new Date() // viewer-local reference for humanized times (client render)
  const cur = new Date(msg.createdAt)
  const prevDate = prev ? new Date(prev.createdAt) : null
  const newDay = !prevDate || cur.toDateString() !== prevDate.toDateString()
  // Existing grouping predicate: same author + same day + within 5 min. Two
  // forced-leading conditions layer on top: `newDay` (already excluded via
  // `!newDay`) forces a leading row after a day divider, and `forceLeading`
  // (Task 9's first-unread) forces one explicitly.
  const grouped = !!prev && !newDay && prev.author.id === msg.author.id && cur.getTime() - prevDate!.getTime() < 5 * 60 * 1000 && !forceLeading
  const leading = !grouped

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

  const tbBtn = 'rounded px-1 text-sm leading-none hover:bg-hover'

  return (
    // Day dividers and the "New messages" line are pane-level siblings (rendered
    // by MessagePane), not part of this row — so a message stays a self-contained
    // grid cell. A temp (optimistic) row is dimmed to 60% and settles to 100%
    // once the real message replaces it.
    <div className={`group relative grid grid-cols-[36px_1fr] gap-2 border-l-2 px-4 py-0.5 transition-opacity duration-200 hover:bg-hover ${leading ? 'pt-2' : ''} ${isTemp ? 'opacity-60' : 'opacity-100'} ${selfMention ? 'border-[var(--accent)] bg-mention' : 'border-transparent'}`}>
        {/* Column 1 — gutter: avatar on leading rows, hover-only clock on grouped rows. */}
        {leading ? (
          <Avatar name={msg.author.name} id={msg.author.id} image={msg.author.image} size={36} />
        ) : (
          <time
            aria-hidden
            dateTime={msg.createdAt}
            title={msg.createdAt}
            className="hidden text-right text-2xs leading-[22px] tabular-nums text-subtle group-hover:block"
          >{clockTime(msg.createdAt)}</time>
        )}

        {/* Column 2 — content. */}
        <div className="min-w-0">
          {leading ? (
            <div className="flex items-baseline gap-1.5">
              <span
                className="font-semibold text-default"
                style={{ color: `hsl(${avatarHue(msg.author.id)} 45% var(--author-name-l))` }}
              >{msg.author.name}</span>
              <time className="text-xs text-muted" dateTime={msg.createdAt} title={msg.createdAt}>{humanTime(msg.createdAt, now)}</time>
            </div>
          ) : (
            // Grouped rows hide author + time visually; expose them to screen readers so
            // each row still announces author, time, then text.
            <span className="sr-only">{msg.author.name}, {humanTime(msg.createdAt, now)}</span>
          )}

          {editing ? (
            <div className="mt-0.5">
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus rows={2}
                onKeyDown={(e) => {
                  // stopPropagation so cancelling an edit doesn't also close the thread panel's document-level Escape.
                  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(false); return }
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void saveEdit() }
                }}
                className="w-full rounded-md border border-strong bg-surface px-2 py-1 text-base text-default" />
              <div className="mt-1 flex items-center gap-2 text-xs">
                <button onClick={saveEdit} disabled={busy} className="rounded bg-accent px-2 py-0.5 font-medium text-white disabled:opacity-50">Save</button>
                <button onClick={() => setEditing(false)} className="rounded border border-border px-2 py-0.5">Cancel</button>
                <span className="text-subtle">Enter to save · Esc to cancel</span>
              </div>
            </div>
          ) : msg.deleted ? (
            <p className="text-base italic text-subtle">message deleted</p>
          ) : (
            <p className="whitespace-pre-wrap break-words text-base text-default">
              {renderTokens(msg.body, names, selfId)}
              {msg.editedAt && <span className="ml-1 text-2xs text-subtle">(edited)</span>}
            </p>
          )}

          {!msg.deleted && !editing && msg.attachments.map((a) => (
            a.mime.startsWith('image/')
              ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={a.id} src={a.path} alt={a.name} className="mt-1 max-h-64 rounded-lg border border-border" />
              ) : (
                <a key={a.id} href={a.path} target="_blank" rel="noreferrer" download={a.name}
                  className="mt-1 flex w-fit items-center gap-2 rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-hover">
                  <span>📄</span><span className="max-w-xs truncate">{a.name}</span>
                  <span className="text-subtle">{Math.max(1, Math.round(a.size / 1024))} KB</span>
                </a>
              )
          ))}

          {!msg.deleted && msg.reactions.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {msg.reactions.map((rx) => {
                const mine = rx.userIds.includes(selfId)
                return (
                  <button key={rx.emoji} onClick={() => react(rx.emoji)}
                    className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs ${mine ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted hover:bg-hover'}`}>
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

          {isTemp && msg.sendFailed && (
            <p className="mt-0.5 text-xs text-[var(--color-danger)]">
              Not delivered ·{' '}
              <button type="button" onClick={() => onRetry?.(msg)} className="font-medium underline">Retry</button>
            </p>
          )}
        </div>

        {!msg.deleted && !isTemp && !editing && (
          <div className="absolute -top-3 right-2 z-10 hidden items-center gap-0.5 rounded-md border border-border bg-surface px-1 py-0.5 shadow-sm group-hover:flex">
            <button title="React 👍" onClick={() => react('👍')} className={tbBtn}>👍</button>
            <div className="relative">
              <button title="Add reaction" onClick={() => setShowPicker((v) => !v)} className={tbBtn}>😊</button>
              {showPicker && (
                <div className="absolute right-0 top-6 z-20 flex w-40 flex-wrap gap-1 rounded-md border border-border bg-surface p-1 shadow-menu">
                  {EMOJIS.map((e) => (
                    <button key={e} onClick={() => react(e)} className="rounded px-1 py-0.5 text-base hover:bg-hover">{e}</button>
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
          <div className="absolute right-2 top-5 z-20 flex items-center gap-2 rounded-md border border-danger/40 bg-surface px-2 py-1 text-xs shadow-menu">
            <span className="text-muted">Delete message?</span>
            <button onClick={del} disabled={busy} className="rounded bg-danger px-2 py-0.5 font-medium text-white disabled:opacity-50">Delete</button>
            <button onClick={() => setConfirmDel(false)} className="rounded border border-border px-2 py-0.5">Cancel</button>
          </div>
        )}
      </div>
  )
}
