// src/features/chat/clipboard-files.ts
// Wave-7.1: the SINGLE clipboard extraction path for chat paste. A bare
// `clipboardData.files` read (the wave-7 shape) missed real macOS screenshot
// pastes in Chromium — the OS pasteboard flavor can leave `.files` EMPTY while
// `items` (or a text/html data-URL payload) still carries the image — and the
// browser's default insert then degraded the paste to the literal synthesized
// filename text ("image.png"). Pure and DOM-free (regex, not DOMParser) so it
// unit-tests in the node environment; the parameter is a STRUCTURAL subset of
// DataTransfer so both real events and test fakes fit.

// Extension→MIME sniff for files whose `type` arrived empty (another paste
// quirk: synthesized files can carry a name but no MIME — the client gate
// would reject them as "type not allowed"). Values MUST stay within CHAT_MIMES
// (drift-checked in clipboard-files.test.ts) and mirror uploads.ts's
// CHAT_ALLOWED extensions; .zip sniffs to the CANONICAL application/zip.
export const EXT_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

function withSniffedType(f: File): File {
  if (f.type) return f
  const dot = f.name.lastIndexOf('.')
  if (dot === -1) return f
  const mime = EXT_MIME[f.name.slice(dot).toLowerCase()]
  return mime ? new File([f], f.name, { type: mime, lastModified: f.lastModified }) : f
}

// A data:image/...;base64,... src inside a pasted text/html payload (the "copy
// image from a web page" flavor). REMOTE src URLs are deliberately ignored:
// fetching arbitrary URLs client-side is out of scope — only self-contained
// data URLs are decoded.
const DATA_IMG_SRC = /<img[^>]+src=["']data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)["']/gi
const EXT_OF: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

function filesFromHtml(html: string): File[] {
  const out: File[] = []
  for (const m of html.matchAll(DATA_IMG_SRC)) {
    const mime = m[1]!.toLowerCase()
    const bytes = Uint8Array.from(atob(m[2]!), (c) => c.charCodeAt(0))
    out.push(new File([bytes], `pasted-image.${EXT_OF[mime]}`, { type: mime }))
  }
  return out
}

// Structural slice of DataTransfer: exactly the members this extractor reads.
// Real DataTransfer/DataTransferItemList are array-like (length + indexed
// getter), which Array.from handles on every browser; fakes pass plain arrays.
export type ClipboardDataLike = {
  files?: ArrayLike<File>
  items?: ArrayLike<{ kind: string; getAsFile: () => File | null }>
  getData?: (format: string) => string
}

export function extractClipboardFiles(dt: ClipboardDataLike | null): File[] {
  if (!dt) return []
  const files = Array.from(dt.files ?? [])
  if (files.length) return files.map(withSniffedType)
  const fromItems: File[] = []
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === 'file') {
      const f = item.getAsFile()
      if (f) fromItems.push(withSniffedType(f))
    }
  }
  if (fromItems.length) return fromItems
  const html = dt.getData?.('text/html') ?? ''
  return html ? filesFromHtml(html) : []
}

// Wave-7.2: Chromium's synthesized filename for a pasted image is a small
// family of tokens ("image.png", "image (1).png", "screenshot.png",
// "pasted image.png", …). When a paste carries NOTHING but text shaped like
// one of these, the image failed to materialize in ANY clipboard channel —
// treat it as a suspicious paste (kill the junk insert, try clipboard.read()).
const SYNTH_NAME = /^(?:image|screenshot|screen shot|pasted[ -]?image)(?:\s*\(\d+\))?\.(?:png|jpe?g|webp|gif|tiff?)$/i
export function looksLikeSynthesizedFilename(text: string): boolean {
  return SYNTH_NAME.test(text.trim())
}

// Wave-7.2 escalation: read the OS clipboard DIRECTLY (navigator.clipboard.read),
// bypassing the paste event's DataTransfer entirely — the Slack approach. Every
// synthesizable clipboard shape attaches via the paste event on this machine's
// Chrome 151, yet a real-world paste still degraded to filename text, so some
// source (clipboard manager, remote/universal clipboard, extension) delivers a
// shape the event never surfaces. This reads the actual clipboard image.
// Chrome prompts for read permission the first time (per-site); denial or an
// unavailable API rejects/throws — callers surface the fallback error.
export async function tryClipboardReadImage(): Promise<File | null> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.read) return null
  try {
    const items = await navigator.clipboard.read()
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'))
      if (!type) continue
      const blob = await item.getType(type)
      const ext = EXT_OF[type] ?? 'png'
      return new File([blob], `pasted-image.${ext}`, { type })
    }
    return null
  } catch {
    // Permission denied / not allowed in this context / no clipboard data.
    return null
  }
}
