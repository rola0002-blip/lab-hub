'use client'
import { Fragment, useState, type ReactNode } from 'react'
import { Copy, Check } from 'lucide-react'
import { tokenizeMessage, type Token } from '@/features/chat/markdown'
import { IssueRefPill, type RefData } from './issue-ref-pill'

// Message-body rendering lives here rather than in message-item.tsx so the
// non-chat surfaces that reuse it (project updates, issue detail/timeline) don't
// drag the whole message row — the emoji picker above all — into their route
// bundles. message-item.tsx re-exports `renderTokens` for compatibility.

export type Names = Map<string, string>

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
