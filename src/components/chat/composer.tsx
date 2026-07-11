'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Bold, Italic, Strikethrough, Link as LinkIcon, Code, List, Quote, Smile, Send, Paperclip } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { searchEmoji } from '@/features/chat/emoji'
import { wrapSelection, detectTrigger } from '@/features/chat/compose-format'
import { useChat } from './chat-store'
import { EmojiPicker } from './emoji-picker'
import type { Msg } from './message-item'

type Props = {
  conversationId: string
  selfRole: string
  memberIds: string[]
  parentId?: string
  onSent: (m: Msg) => void
  onRemove: (tempId: string) => void
  // Task 9 (optimistic send): when provided, a failed send keeps the temp in the
  // timeline (flagged for an inline "Not delivered · Retry") instead of removing
  // it, and the draft is cleared. The thread panel omits it, keeping the original
  // behaviour (drop the temp, keep the draft, surface a composer-level error).
  onFail?: (tempId: string) => void
  // Task 13: the thread composer offers an "Also send to #channel" checkbox that
  // broadcasts the reply into the channel timeline (broadcast:true on the POST).
  showBroadcast?: boolean
  broadcastLabel?: string
  // Task 18 (keyboard model): the MAIN pane composer auto-focuses on channel open
  // and is the Esc-return target (marked with data-main-composer). `onNavigateUp`
  // fires when ↑ is pressed in an empty composer with no open autocomplete — the
  // pane uses it to move focus into the message list at the newest row.
  main?: boolean
  onNavigateUp?: () => void
}

type Attach = { path: string; name: string; mime: string; size: number }
// One autocomplete row. `key` is a stable React key (glyphs can repeat across
// emoji shortnames, so it can't be the token); `token` is the text inserted at
// the trigger; `label` is what the menu shows.
type Item = { key: string; label: string; token: string }

// Read the persisted draft for a (conversation, thread) key. Module-level so the
// storage read stays out of the component's render-purity surface (mirrors the
// emoji-picker's `loadRecents`). SSR-safe: no `window` on the server → ''.
function readDraft(key: string): string {
  if (typeof window === 'undefined') return ''
  try { return window.sessionStorage.getItem(key) ?? '' } catch { return '' }
}

// v1 tradeoff (settled in the task brief): the textarea holds RAW token text
// (`<@id>`, `<!channel>`) directly — autocomplete inserts tokens, and a hint line
// explains they render as friendly @Name once sent. No rich-text dual buffer.
//
// Thin wrapper: drafts are keyed by conversation + thread, so the body is REMOUNTED
// whenever that key changes (channel switch, or main-vs-thread composer). Remounting
// lets the lazy draft-restore initializer re-read sessionStorage for the new
// conversation — the lint-safe alternative to a set-state-in-effect reset.
export default function Composer(props: Props) {
  const draftKey = 'draft:' + props.conversationId + (props.parentId ?? '')
  return <ComposerBody key={draftKey} draftKey={draftKey} {...props} />
}

function ComposerBody({ draftKey, conversationId, selfRole, memberIds, parentId, onSent, onRemove, onFail, showBroadcast = false, broadcastLabel, main = false, onNavigateUp }: Props & { draftKey: string }) {
  const { users, selfId } = useChat()
  const [raw, setRaw] = useState<string>(() => readDraft(draftKey))
  const [broadcast, setBroadcast] = useState(false)
  const [attachments, setAttachments] = useState<Attach[]>([])
  const [menu, setMenu] = useState<{ start: number; items: Item[] } | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(0)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const lastTyping = useRef(0)

  const self = users.find((u) => u.id === selfId)
  const selfName = self?.name ?? 'You'
  const selfImage = self?.image ?? null
  const memberUsers = useMemo(() => {
    const ids = new Set(memberIds)
    return users.filter((u) => ids.has(u.id))
  }, [memberIds, users])

  // Persist the draft per (conversation, thread) so it survives a channel switch;
  // an empty draft removes the key (this is how a successful send clears it). The
  // effect only touches sessionStorage — never setState — so
  // `react-hooks/set-state-in-effect` stays satisfied.
  useEffect(() => {
    try {
      if (raw) window.sessionStorage.setItem(draftKey, raw)
      else window.sessionStorage.removeItem(draftKey)
    } catch { /* private mode / quota — drafts are best-effort */ }
  }, [draftKey, raw])

  // Refresh the autocomplete menu from the caret: `@` mentions first, then the
  // `:emoji:` completion. Both share one trigger scanner (`detectTrigger`) and the
  // same menu machinery (arrow keys / Enter / click all route through `insert`).
  function updateMenu(value: string, caret: number) {
    const at = detectTrigger(value, caret, '@')
    if (at) {
      const q = at.query.toLowerCase()
      const items: Item[] = []
      if (selfRole !== 'guest' && 'channel'.startsWith(q)) items.push({ key: '<!channel>', label: '@channel', token: '<!channel>' })
      for (const u of memberUsers) {
        if (items.length >= 8) break
        if (u.name.toLowerCase().includes(q)) items.push({ key: `<@${u.id}>`, label: u.name, token: `<@${u.id}>` })
      }
      if (items.length) { setMenu({ start: at.from, items }); setActiveIdx(0); return }
      setMenu(null); return
    }
    // `:x` (at least one char after the colon) opens the emoji completion; a lone
    // `:` is left alone so it never floods the menu with every glyph.
    const colon = detectTrigger(value, caret, ':')
    if (colon && colon.query.length >= 1) {
      const items: Item[] = searchEmoji(colon.query).slice(0, 8).map(({ shortname, glyph }) => ({
        key: `emoji:${shortname}`, label: `${glyph}  :${shortname}:`, token: glyph,
      }))
      if (items.length) { setMenu({ start: colon.from, items }); setActiveIdx(0); return }
    }
    setMenu(null)
  }

  // Insert a chosen menu item's token at the trigger, replacing the query text and
  // appending a trailing space (mentions and emoji glyphs alike).
  function insert(item: Item) {
    if (!menu) return
    const el = taRef.current
    const caret = el ? el.selectionStart : raw.length
    const inserted = raw.slice(0, menu.start) + item.token + ' '
    setRaw(inserted + raw.slice(caret))
    setMenu(null)
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(inserted.length, inserted.length) } })
  }

  // Formatting toolbar / keyboard shortcuts: wrap the current textarea selection
  // with `marker` (or a line prefix / link) and restore the useful selection.
  function applyFormat(marker: string) {
    const el = taRef.current
    const start = el ? el.selectionStart : raw.length
    const end = el ? el.selectionEnd : raw.length
    const r = wrapSelection(raw, start, end, marker)
    setRaw(r.value)
    setMenu(null)
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(r.selStart, r.selEnd) } })
  }

  // Emoji BUTTON (picker): drop the glyph in at the caret (no trailing space —
  // this is a deliberate pick, not an autocompletion).
  function insertEmoji(glyph: string) {
    const el = taRef.current
    const start = el ? el.selectionStart : raw.length
    const end = el ? el.selectionEnd : raw.length
    const next = raw.slice(0, start) + glyph + raw.slice(end)
    setRaw(next)
    setEmojiOpen(false)
    const pos = start + glyph.length
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(pos, pos) } })
  }

  function maybeTyping() {
    if (parentId) return // thread drafts don't surface as channel typing
    const now = Date.now()
    if (now - lastTyping.current < 3000) return
    lastTyping.current = now
    void fetch(`/api/chat/conversations/${conversationId}/typing`, { method: 'POST' })
  }

  async function onFiles(files: FileList) {
    setError(null)
    for (const file of Array.from(files)) {
      setUploading((n) => n + 1)
      try {
        const fd = new FormData(); fd.append('file', file)
        const r = await fetch('/api/chat/attachments', { method: 'POST', body: fd })
        const d = await r.json().catch(() => null)
        if (r.ok && d) setAttachments((prev) => [...prev, { path: d.path, name: d.name, mime: d.mime, size: d.size }])
        else setError(d?.message ?? 'Upload failed.')
      } catch { setError('Upload failed.') } finally { setUploading((n) => n - 1) }
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  async function send() {
    const body = raw.trim()
    if ((!body && attachments.length === 0) || busy || uploading > 0) return
    setError(null)
    // send() only runs from the Send button / Enter key — never during render — so these
    // clock reads are safe; the compiler's purity check can't see the event-handler boundary.
    // eslint-disable-next-line react-hooks/purity
    const tempId = 'tmp-' + Date.now()
    const temp: Msg = {
      id: tempId, conversationId, parentId: parentId ?? null,
      author: { id: selfId, name: selfName, image: selfImage },
      body, deleted: false, editedAt: null, createdAt: new Date().toISOString(),
      replyCount: 0, replyParticipants: [], lastReplyAt: null, reactions: [],
      attachments: attachments.map((a, i) => ({ id: `${tempId}-a${i}`, ...a })),
      mentionUserIds: [], mentionsChannel: false,
    }
    const payload = { conversationId, body, ...(parentId ? { parentId } : {}), ...(parentId && broadcast ? { broadcast: true } : {}), ...(attachments.length ? { attachments } : {}) }
    onSent(temp)
    setMenu(null); setBusy(true)
    try {
      const r = await fetch('/api/chat/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const d = await r.json().catch(() => null)
      if (r.status === 201 && d?.message) {
        onSent(d.message)
        // Clear the draft only once the send is confirmed (201).
        setRaw(''); setAttachments([]); setBroadcast(false)
      } else if (onFail) {
        // Retry-aware pane: keep the temp (flagged failed) as the retry surface and
        // clear the draft, since the message now lives in the timeline.
        onFail(tempId); setRaw(''); setAttachments([])
      } else {
        // No retry surface (thread panel): drop the temp and keep the draft.
        setError(d?.message ?? 'Failed to send.'); onRemove(tempId)
      }
    } catch {
      if (onFail) { onFail(tempId); setRaw(''); setAttachments([]) }
      else { setError('Failed to send.'); onRemove(tempId) }
    } finally { setBusy(false) }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // ↑ in an empty main composer (no open autocomplete) enters the message list
    // at the newest row — the keyboard path back into history.
    if (main && e.key === 'ArrowUp' && !menu && raw === '' && e.currentTarget.selectionStart === 0) {
      e.preventDefault(); onNavigateUp?.(); return
    }
    // Formatting shortcuts (before the menu/Enter branches): Cmd/Ctrl+B/I and
    // Cmd/Ctrl+Shift+C for bold / italic / inline code.
    const mod = e.metaKey || e.ctrlKey
    if (mod && !e.shiftKey && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); applyFormat('**'); return }
    if (mod && !e.shiftKey && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); applyFormat('_'); return }
    if (mod && e.shiftKey && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); applyFormat('`'); return }
    if (menu) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => (i + 1) % menu.items.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => (i - 1 + menu.items.length) % menu.items.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(menu.items[activeIdx]); return }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
  }

  const canSend = !busy && uploading === 0 && (!!raw.trim() || attachments.length > 0)

  return (
    <div className="relative border-t border-border p-3">
      {menu && (
        <ul className="absolute bottom-full left-3 z-20 mb-1 w-64 overflow-hidden rounded-md border border-border bg-surface shadow-menu">
          {menu.items.map((it, i) => (
            <li key={it.key}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); insert(it) }}
                className={`block w-full px-3 py-1.5 text-left text-sm ${i === activeIdx ? 'bg-accent-subtle text-[var(--text-accent)]' : 'text-default hover:bg-hover'}`}>
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((a, i) => (
            <span key={a.path} className="flex items-center gap-1 rounded-md border border-border bg-surface-sunken px-2 py-1 text-xs text-muted">
              <span className="max-w-[10rem] truncate">📎 {a.name}</span>
              <button onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} className="text-subtle hover:text-default" aria-label="Remove attachment">✕</button>
            </span>
          ))}
        </div>
      )}

      {/* Formatting toolbar (lucide icons only; emoji stays content). Each button
          wraps the textarea selection via wrapSelection, then refocuses. */}
      <div className="mb-1.5 flex items-center gap-0.5">
        <IconButton label="Bold (⌘B)" onClick={() => applyFormat('**')}><Bold size={16} aria-hidden /></IconButton>
        <IconButton label="Italic (⌘I)" onClick={() => applyFormat('_')}><Italic size={16} aria-hidden /></IconButton>
        <IconButton label="Strikethrough" onClick={() => applyFormat('~')}><Strikethrough size={16} aria-hidden /></IconButton>
        <IconButton label="Link" onClick={() => applyFormat('[]()')}><LinkIcon size={16} aria-hidden /></IconButton>
        <IconButton label="Code (⌘⇧C)" onClick={() => applyFormat('`')}><Code size={16} aria-hidden /></IconButton>
        <IconButton label="Bulleted list" onClick={() => applyFormat('- ')}><List size={16} aria-hidden /></IconButton>
        <IconButton label="Quote" onClick={() => applyFormat('> ')}><Quote size={16} aria-hidden /></IconButton>
        <div className="relative">
          <IconButton label="Emoji" active={emojiOpen} onClick={() => setEmojiOpen((o) => !o)}><Smile size={16} aria-hidden /></IconButton>
          {emojiOpen && <EmojiPicker align="left" onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />}
        </div>
      </div>

      <div className="flex items-end gap-2">
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => e.target.files && onFiles(e.target.files)} />
        <IconButton label="Attach a file" onClick={() => fileRef.current?.click()}><Paperclip size={16} aria-hidden /></IconButton>
        <textarea ref={taRef} value={raw} rows={1} placeholder={parentId ? 'Reply in thread…' : 'Write a message…'}
          aria-label={parentId ? 'Reply in thread' : 'Write a message'}
          autoFocus={main} {...(main ? { 'data-main-composer': '' } : {})}
          suppressHydrationWarning
          onChange={(e) => { setRaw(e.target.value); updateMenu(e.target.value, e.target.selectionStart); maybeTyping() }}
          onKeyDown={onKeyDown} onBlur={() => setTimeout(() => setMenu(null), 100)}
          className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-default placeholder:text-subtle focus-visible:border-[var(--border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
        {/* `disabled` derives from `raw`, which is '' during SSR but restored from a
            sessionStorage draft on the client — an intentional divergence, like the
            textarea value above, so the hydration warning is suppressed. */}
        <button type="button" onClick={send} disabled={!canSend} suppressHydrationWarning
          aria-label="Send message" title={uploading > 0 ? 'Uploading…' : busy ? 'Sending…' : 'Send message'}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent text-accent-on transition-colors hover:bg-accent-hover disabled:opacity-50">
          <Send size={16} aria-hidden />
        </button>
      </div>

      {showBroadcast && (
        <label className="mt-1 flex w-fit items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={broadcast} onChange={(e) => setBroadcast(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border accent-[var(--accent)]" />
          Also send to {broadcastLabel ?? 'channel'}
        </label>
      )}

      <p className="mt-1 text-[11px] text-muted">
        Enter to send · Shift+Enter for a newline · mentions and :emoji: autocomplete (they render once sent).
      </p>
      {error && <p className="mt-1 text-xs text-[var(--text-danger)]">{error}</p>}
    </div>
  )
}
