'use client'
import { Fragment, useState, type ReactNode } from 'react'
import { Copy, Check, Smile, SmilePlus, MessageSquare, Forward, Bookmark, MoreHorizontal, ListPlus } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { IconButton } from '@/components/ui/icon-button'
import { Menu } from '@/components/ui/menu'
import { avatarHue } from '@/lib/avatar'
import { humanTime, clockTime } from '@/lib/humanize'
import { tokenizeMessage, type Token } from '@/features/chat/markdown'
import { EMOJI_MAP } from '@/features/chat/emoji'
import { openIssueComposer } from '@/lib/issue-composer-store'
import { openProjectUpdateComposer } from '@/lib/project-update-composer-store'
import { toast } from '@/lib/toast-store'
import { useChat } from './chat-store'
import { EmojiPicker } from './emoji-picker'
import { IssueRefPill, type RefData } from './issue-ref-pill'
import { useIssueRefs } from './issue-ref-store'

// Client-side mirror of the server MessageDto (message-service is `server-only`,
// so we redeclare the shape here rather than import it into a client bundle).
export type Msg = {
  id: string
  conversationId: string
  parentId: string | null
  // 'system' rows (created/joined event lines) render as a centered muted line in
  // the pane, never through MessageItem. Absent on optimistic temps → treated as
  // 'user'. Always present on server DTOs.
  kind?: 'user' | 'system'
  author: { id: string; name: string; image: string | null }
  body: string
  deleted: boolean
  editedAt: string | null
  createdAt: string
  replyCount: number
  // Thread facepile source (root messages only): distinct reply authors (≤5,
  // newest first) + the most recent reply time. Empty / null on replies.
  replyParticipants: { id: string; name: string; image: string | null }[]
  lastReplyAt: string | null
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

// Reverse of EMOJI_MAP: glyph → a readable, screen-reader-friendly name, so a
// reaction lozenge's accessible name never collapses to color/glyph alone.
// Prefers an alphabetic shortname (skip `+1`, `100`, …) and falls back to the
// glyph itself for anything outside our curated map.
const GLYPH_TO_NAME: Record<string, string> = (() => {
  const rev: Record<string, string> = {}
  for (const [shortname, glyph] of Object.entries(EMOJI_MAP)) {
    const alpha = /^[a-z]/.test(shortname)
    if (!(glyph in rev) || (alpha && !/^[a-z]/.test(rev[glyph]))) rev[glyph] = shortname
  }
  return rev
})()
function emojiLabel(glyph: string): string {
  const name = GLYPH_TO_NAME[glyph]
  return name ? name.replace(/_/g, ' ') : glyph
}

// Human "who reacted" summary for a lozenge tooltip: "Ada", "Ada and Rex",
// "Ada, Rex and Sam", then "Ada, Rex and N others" beyond three.
function whoReacted(userIds: string[], names: Names): string {
  const list = userIds.map((id) => names.get(id) ?? 'Someone')
  if (list.length <= 1) return list[0] ?? ''
  if (list.length === 2) return `${list[0]} and ${list[1]}`
  if (list.length === 3) return `${list[0]}, ${list[1]} and ${list[2]}`
  return `${list[0]}, ${list[1]} and ${list.length - 2} others`
}

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
function renderToken(t: Token, key: number, names: Names, selfId: string | undefined, jumbo: boolean, refs: Map<number, RefData> | null): ReactNode {
  switch (t.type) {
    case 'bold': return <strong key={key} className="font-semibold text-default">{t.value}</strong>
    case 'italic': return <em key={key}>{t.value}</em>
    case 'strike': return <s key={key}>{t.value}</s>
    case 'code': return <code key={key} className="rounded bg-surface-sunken px-1 font-mono text-[13px]">{t.value}</code>
    case 'codeblock': return <CodeBlock key={key} value={t.value} />
    case 'quote': return <span key={key} className="my-0.5 block border-l-2 border-border pl-2 text-muted">{t.value}</span>
    case 'listitem': return <span key={key} className="block pl-1">• {t.value}</span>
    // href is scheme-locked to http(s) at tokenize time (markdown.ts), so a
    // non-http(s) url never reaches here. `label` is the visible text of a
    // markdown link; a bare-URL link (label undefined) shows its url.
    case 'link': return <a key={key} href={t.value} target="_blank" rel="noreferrer" className="text-link hover:underline">{t.label ?? t.value}</a>
    case 'channel': return <span key={key} className="rounded bg-accent-subtle px-1 font-medium text-[var(--text-accent)]">@channel</span>
    case 'mention': {
      const isSelf = !!selfId && t.userId === selfId
      return (
        <span key={key} className={`rounded px-1 font-medium text-[var(--text-accent)] ${isSelf ? 'bg-mention' : 'bg-accent-subtle'}`}>
          @{names.get(t.userId ?? t.value) ?? 'unknown'}
        </span>
      )
    }
    case 'emoji': return <span key={key} className={jumbo ? 'align-middle text-3xl leading-none' : undefined}>{t.value}</span>
    // Resolved → accent pill (identifier + live title + status dot, struck-through
    // for Done/Canceled); unresolvable → plain `LAB-<n>` text (pill decides).
    case 'issueRef': return <IssueRefPill key={key} number={t.value} resolved={refs?.get(Number(t.value)) ?? undefined} />
    default: return <Fragment key={key}>{t.value}</Fragment>
  }
}

// Build the message body as React nodes. Subsumes the old mention/URL renderer
// (mentions + links render identically) and adds markdown, code, quotes, lists
// and emoji — all via tokens, never dangerouslySetInnerHTML. A body of ≤3 emoji
// with no real text renders "jumbo".
export function renderTokens(body: string, names: Names, selfId?: string, refs: Map<number, RefData> | null = null): ReactNode[] {
  const tokens = tokenizeMessage(body)
  const meaningful = tokens.filter((t) => !(t.type === 'text' && t.value.trim() === ''))
  const jumbo = meaningful.length > 0 && meaningful.length <= 3 && meaningful.every((t) => t.type === 'emoji')
  return tokens.map((t, k) => renderToken(t, k, names, selfId, jumbo, refs))
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
  // Task 13: rendered as the root INSIDE the thread panel. Suppresses the
  // thread affordances (facepile + "reply in thread") that are redundant there.
  inThread?: boolean
  // Task 18 (roving focus): the main pane makes exactly one row a tab stop (the
  // active/newest one) and the rest tabIndex=-1, reachable via ↑/↓. Defaults to a
  // normal tab stop for the thread panel, which isn't roving.
  tabIndex?: number
}

export default function MessageItem({ msg, prev, names, selfId, selfRole, onUpdated, onOpenThread, forceLeading = false, onRetry, inThread = false, tabIndex = 0 }: Props) {
  const { online } = useChat()
  // Pane-provided resolved-ref Map (null outside a provider → pills render plain text).
  const issueRefs = useIssueRefs()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(msg.body)
  // Which emoji picker is open, if any: the hover-toolbar face or the reaction
  // "+" chip. One at a time; both feed the same `react()`.
  const [pickerAt, setPickerAt] = useState<'toolbar' | 'chip' | null>(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  const own = msg.author.id === selfId
  const canDelete = own || selfRole === 'admin'
  // Guests are read-only for issues AND project updates (issue-hotkeys.tsx /
  // command-palette gate them too); hide the create-issue affordances and the
  // "Post as project update" item so a guest never raises a modal that only 403s
  // at submit. The service is the real gate; this is the UI half.
  const canCreateIssue = selfRole !== 'guest'
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

  // Refetch this message after a mutation. A transient GET failure is swallowed
  // (never a throw → unhandled rejection): the pane's SSE rx/msg_edit/msg_del event
  // refetches too, so the row still converges on server truth without a toast here.
  async function refresh() {
    try {
      const r = await fetch(`/api/chat/messages/${msg.id}`)
      if (r.ok) onUpdated((await r.json()).message)
    } catch { /* transient network error; SSE reconciles */ }
  }
  async function react(emoji: string) {
    setPickerAt(null)
    try {
      const r = await fetch(`/api/chat/messages/${msg.id}/reactions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emoji }),
      })
      if (!r.ok) throw new Error('reaction failed')
      await refresh()
    } catch {
      // No optimistic local state to roll back — the lozenges render from the
      // server DTO, so on failure we just surface it and leave the row unchanged.
      toast('Could not update your reaction. Please try again.')
    }
  }
  async function saveEdit() {
    const body = draft.trim()
    if (!body) return
    setBusy(true)
    try {
      const r = await fetch(`/api/chat/messages/${msg.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
      })
      if (!r.ok) throw new Error('edit failed')
      setEditing(false) // exit the editor only on success; a failure keeps it open with the draft intact
      await refresh()
    } catch {
      toast('Could not save your edit. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  async function del() {
    setBusy(true)
    try {
      const r = await fetch(`/api/chat/messages/${msg.id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('delete failed')
      setConfirmDel(false)
      await refresh()
    } catch {
      toast('Could not delete the message. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  // Copy a deep-link to this message (`/chat/<cid>?msg=<id>`) and flash an inline
  // "Link copied" confirmation. The global toast system is Task 17's; this is a
  // self-contained transient state, cleared from an event-handler timer.
  function copyLink() {
    void navigator.clipboard?.writeText(`${window.location.origin}/chat/${msg.conversationId}?msg=${msg.id}`)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 1500)
  }
  // Open the shared create-issue composer pre-filled from this message: title = the
  // first line (truncated), description = the whole body quoted + author attribution,
  // originMessageId set so the new issue backlinks here (T13 composer pushes to the
  // new issue on create). The FK is onDelete:SetNull — deleting the message later
  // just nulls the link, never the issue.
  function createFromMessage() {
    const firstLine = msg.body.split('\n')[0].slice(0, 120)
    const quoted = msg.body.split('\n').map((l) => `> ${l}`).join('\n')
    openIssueComposer({ title: firstLine, description: `${quoted}\n\n— ${msg.author.name}`, originMessageId: msg.id, assignToSelf: true }) // quick capture → assign self
  }
  // Capture an already-written narrative as a project update (SP8 §4.6): quoted
  // body + author attribution, originMessageId for the backlink. Same guest gate
  // as create-issue; the server rejects regardless.
  function postAsUpdate() {
    const quoted = msg.body.split('\n').map((l) => `> ${l}`).join('\n')
    openProjectUpdateComposer({ body: `${quoted}\n\n— ${msg.author.name}`, originMessageId: msg.id })
  }

  // Presence of the message author, mirrored off the store's `online` set (same
  // source the DM rows/header use). Shown on the leading avatar as a filled dot
  // (active) / hollow ring (away) — a shape difference, never colour alone, and
  // paired with an sr-only label.
  const authorPresence: 'active' | 'away' = online.has(msg.author.id) ? 'active' : 'away'

  // The ⋯ overflow menu. Edit is author-only; Delete is author-or-admin; Copy
  // link is always available; Pin has no model yet, so it renders disabled.
  const menuItems = [
    ...(own ? [{ label: 'Edit', onSelect: () => { setDraft(msg.body); setEditing(true) } }] : []),
    { label: 'Copy link', onSelect: copyLink },
    ...(canCreateIssue ? [{ label: 'Create issue', onSelect: createFromMessage }] : []),
    ...(canCreateIssue ? [{ label: 'Post as project update', onSelect: postAsUpdate }] : []),
    { label: 'Pin', onSelect: () => {}, disabled: true },
    ...(canDelete ? [{ label: 'Delete', onSelect: () => setConfirmDel(true), danger: true }] : []),
  ]

  return (
    // Day dividers and the "New messages" line are pane-level siblings (rendered
    // by MessagePane), not part of this row — so a message stays a self-contained
    // grid cell. A temp (optimistic) row is dimmed to 60% and settles to 100%
    // once the real message replaces it.
    // `tabIndex`/`data-*` make each row a focus target the pane's `r` hotkey can
    // resolve to; focus also reveals the toolbar (group-focus-within), so the
    // toolbar is reachable by keyboard, not hover alone.
    <div
      tabIndex={tabIndex}
      data-msg-id={msg.id}
      data-root={String(!msg.parentId)}
      className={`group relative grid grid-cols-[36px_1fr] gap-2 border-l-2 px-4 py-0.5 outline-none transition-opacity duration-200 hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${leading ? 'pt-2' : ''} ${isTemp ? 'opacity-60' : 'opacity-100'} ${selfMention ? 'border-[var(--accent)] bg-mention' : 'border-transparent'}`}>
        {/* Column 1 — gutter: avatar on leading rows, hover-only clock on grouped rows. */}
        {leading ? (
          <Avatar name={msg.author.name} id={msg.author.id} image={msg.author.image} size={36} presence={authorPresence} />
        ) : (
          <time
            aria-hidden
            dateTime={msg.createdAt}
            title={msg.createdAt}
            className="hidden text-right text-2xs leading-[22px] tabular-nums text-subtle group-hover:block"
          >{clockTime(msg.createdAt)}</time>
        )}

        {/* Column 2 — content. Pinned to grid column 2 explicitly: on a grouped row
            the column-1 gutter <time> is display:none until hover, and without an
            explicit column the body would auto-place into the 36px gutter track
            (wrapping ~one word per line) and only jump to the wide column on hover. */}
        <div className="col-start-2 min-w-0">
          {leading ? (
            <div className="flex items-baseline gap-1.5">
              <span
                className="font-semibold text-default"
                style={{ color: `hsl(${avatarHue(msg.author.id)} 45% var(--author-name-l))` }}
              >{msg.author.name}</span>
              <time className="text-xs text-muted" dateTime={msg.createdAt} title={msg.createdAt}>{humanTime(msg.createdAt, now)}</time>
              <span className="sr-only">{authorPresence === 'active' ? 'Active' : 'Away'}</span>
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
                <button onClick={saveEdit} disabled={busy} className="rounded bg-accent px-2 py-0.5 font-medium text-accent-on disabled:opacity-50">Save</button>
                <button onClick={() => setEditing(false)} className="rounded border border-border px-2 py-0.5">Cancel</button>
                <span className="text-subtle">Enter to save · Esc to cancel</span>
              </div>
            </div>
          ) : msg.deleted ? (
            <p className="text-base italic text-subtle">message deleted</p>
          ) : (
            <p className="whitespace-pre-wrap break-words text-base text-default">
              {renderTokens(msg.body, names, selfId, issueRefs)}
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
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {msg.reactions.map((rx) => {
                const mine = rx.userIds.includes(selfId)
                return (
                  <button key={rx.emoji} type="button" onClick={() => react(rx.emoji)}
                    aria-pressed={mine}
                    aria-label={`${emojiLabel(rx.emoji)}, ${rx.userIds.length}, react`}
                    title={whoReacted(rx.userIds, names)}
                    className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs tabular-nums ${mine ? 'border-accent bg-accent-subtle font-semibold text-[var(--text-accent)]' : 'border-border text-muted hover:border-border-strong'}`}>
                    {/* Keyed by count so an add remounts the glyph and replays the
                        pop (motion-safe only — skipped under reduced-motion). */}
                    <span key={rx.userIds.length} aria-hidden className="motion-safe:animate-pop">{rx.emoji}</span>
                    <span aria-hidden>{rx.userIds.length}</span>
                  </button>
                )
              })}
              <div className="relative inline-flex">
                <button type="button" aria-label="Add reaction" title="Add reaction"
                  onClick={() => setPickerAt((a) => (a === 'chip' ? null : 'chip'))}
                  className="inline-flex h-6 items-center rounded-full border border-border px-2 text-muted hover:border-border-strong hover:text-default">
                  <SmilePlus size={14} aria-hidden />
                </button>
                {pickerAt === 'chip' && <EmojiPicker align="left" onPick={react} onClose={() => setPickerAt(null)} />}
              </div>
            </div>
          )}

          {!inThread && !msg.parentId && msg.replyCount > 0 && (
            <button onClick={onOpenThread}
              className="mt-1 flex w-fit items-center gap-2 rounded-md py-0.5 pr-2 hover:bg-hover">
              <span className="flex -space-x-1.5">
                {msg.replyParticipants.map((p) => (
                  <span key={p.id} className="rounded-[var(--radius-avatar)] ring-2 ring-[var(--bg-canvas)]">
                    <Avatar name={p.name} id={p.id} image={p.image} size={20} />
                  </span>
                ))}
              </span>
              <span className="text-xs font-medium text-[var(--text-accent)]">
                {msg.replyCount} {msg.replyCount === 1 ? 'reply' : 'replies'}
              </span>
              {msg.lastReplyAt && (
                <span className="text-2xs text-muted">Last reply {humanTime(msg.lastReplyAt, now)}</span>
              )}
            </button>
          )}

          {isTemp && msg.sendFailed && (
            <p className="mt-0.5 text-xs text-[var(--text-danger)]">
              Not delivered ·{' '}
              <button type="button" onClick={() => onRetry?.(msg)} className="font-medium underline">Retry</button>
            </p>
          )}
        </div>

        {!msg.deleted && !isTemp && !editing && (
          // Lucide icons only (emoji stays content). Reachable on hover OR keyboard
          // focus (group-focus-within); kept `flex` while the emoji picker is open
          // so moving the cursor into the popover doesn't collapse the toolbar.
          <div className={`absolute -top-3 right-2 z-10 items-center gap-0.5 rounded-md border border-border bg-surface px-1 py-0.5 shadow-sm ${pickerAt === 'toolbar' ? 'flex' : 'hidden group-hover:flex group-focus-within:flex pointer-coarse:flex'}`}>
            <div className="relative">
              <IconButton label="Add reaction" active={pickerAt === 'toolbar'}
                onClick={() => setPickerAt((a) => (a === 'toolbar' ? null : 'toolbar'))}>
                <Smile size={16} aria-hidden />
              </IconButton>
              {pickerAt === 'toolbar' && <EmojiPicker align="right" onPick={react} onClose={() => setPickerAt(null)} />}
            </div>
            {!inThread && !msg.parentId && (
              <IconButton label="Reply in thread" onClick={onOpenThread}><MessageSquare size={16} aria-hidden /></IconButton>
            )}
            {canCreateIssue && <IconButton label="Create issue from message" onClick={createFromMessage}><ListPlus size={16} aria-hidden /></IconButton>}
            {/* Forward + Save have no backend yet (like Pin) → present but disabled. */}
            <IconButton label="Forward (coming soon)" disabled><Forward size={16} aria-hidden /></IconButton>
            <IconButton label="Save for later (coming soon)" disabled><Bookmark size={16} aria-hidden /></IconButton>
            <Menu label="More actions" button={<MoreHorizontal size={16} aria-hidden />} items={menuItems} />
          </div>
        )}

        {linkCopied && (
          <div role="status" className="absolute -top-3 right-2 z-30 rounded-md border border-border bg-surface px-2 py-1 text-2xs font-medium text-default shadow-menu">
            Link copied
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
