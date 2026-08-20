import { describe, it, expect } from 'vitest'
import { extractClipboardFiles, EXT_MIME, looksLikeSynthesizedFilename } from './clipboard-files'
import { CHAT_MIMES } from './attachment-input'

const file = (name: string, type: string) => new File([new Uint8Array([1, 2, 3])], name, { type })

// Fakes shaped like the extractor's structural slice of DataTransfer — the
// real API cannot represent "items has a file but .files is empty" (adding a
// File mirrors it into .files), which is exactly the macOS quirk being tested.
function fakeDt({ files, items, html = '' }: {
  files?: File[]
  items?: { kind: string; getAsFile: () => File | null }[]
  html?: string
}) {
  return { files, items, getData: (t: string) => (t === 'text/html' ? html : '') }
}

describe('extractClipboardFiles', () => {
  it('returns .files when present (the normal Chromium path)', () => {
    const png = file('shot.png', 'image/png')
    expect(extractClipboardFiles(fakeDt({ files: [png] }))).toEqual([png])
  })

  it('falls back to items when .files is empty (the macOS screenshot quirk)', () => {
    const png = file('image.png', 'image/png')
    const dt = fakeDt({
      items: [
        { kind: 'string', getAsFile: () => null },
        { kind: 'file', getAsFile: () => png },
      ],
    })
    expect(extractClipboardFiles(dt)).toEqual([png])
  })

  it('sniffs an empty MIME from the file extension', () => {
    const sniffed = extractClipboardFiles(fakeDt({ files: [file('image.png', '')] }))[0]!
    expect(sniffed.type).toBe('image/png')
    expect(sniffed.name).toBe('image.png')
    // A name that maps to no allowlisted extension passes through untouched —
    // the shared gate then gives the honest "type not allowed" error.
    const passthrough = extractClipboardFiles(fakeDt({ files: [file('blob.bin', '')] }))[0]!
    expect(passthrough.type).toBe('')
  })

  it('keeps EXT_MIME within CHAT_MIMES (drift guard)', () => {
    for (const mime of Object.values(EXT_MIME)) {
      expect(CHAT_MIMES.has(mime), `EXT_MIME value ${mime} missing from CHAT_MIMES`).toBe(true)
    }
  })

  it('decodes a data-URL <img> from the text/html flavor', async () => {
    const b64 = Buffer.from('labhub').toString('base64')
    const dt = fakeDt({ html: `<meta charset="utf-8"><img src="data:image/png;base64,${b64}" alt="copied">` })
    const files = extractClipboardFiles(dt)
    expect(files).toHaveLength(1)
    expect(files[0]!.name).toBe('pasted-image.png')
    expect(files[0]!.type).toBe('image/png')
    expect(await files[0]!.text()).toBe('labhub')
  })

  it('ignores remote-URL <img> srcs in html', () => {
    const dt = fakeDt({ html: '<img src="https://example.com/photo.png">' })
    expect(extractClipboardFiles(dt)).toEqual([])
  })

  it('returns [] for text-only pastes and null clipboard data', () => {
    expect(extractClipboardFiles(fakeDt({ items: [{ kind: 'string', getAsFile: () => null }] }))).toEqual([])
    expect(extractClipboardFiles(null)).toEqual([])
  })
})

describe('looksLikeSynthesizedFilename', () => {
  it('matches Chromium synthesized image filenames', () => {
    for (const s of ['image.png', 'image.PNG', 'image (1).png', 'image (12).jpg', 'screenshot.png',
      'screen shot.png', 'screen shot.jpeg', 'pasted image.png', 'Pasted-Image.webp', 'pastedimage.gif', 'image.tiff']) {
      expect(looksLikeSynthesizedFilename(s), s).toBe(true)
    }
  })
  it('does not match ordinary text a user might legitimately paste', () => {
    for (const s of ['', 'image.png is attached', 'see image.png below', 'the PNG file', 'imaging.png', 'my-screenshot.png notes', 'plain sentence']) {
      expect(looksLikeSynthesizedFilename(s), s).toBe(false)
    }
  })
})
