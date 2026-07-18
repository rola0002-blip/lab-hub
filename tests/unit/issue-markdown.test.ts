import { describe, it, expect } from 'vitest'
import { tokenizeMessage } from '@/features/chat/markdown'
import { extractIssueRefNumbers } from '@/features/issues/identifier'

describe('issueRef tokenizer pass', () => {
  it('matches word-bounded LAB-<n> and leaves code spans alone', () => {
    const t = tokenizeMessage('see LAB-42 and `LAB-9` plus LABS-1 and LAB-x')
    const refs = t.filter((x) => x.type === 'issueRef').map((x) => x.value)
    expect(refs).toEqual(['42'])
    // `LAB-9` inside inline code stays a code token; LABS-1 / LAB-x never match.
    expect(t.some((x) => x.type === 'code' && x.value === 'LAB-9')).toBe(true)
  })
  // Backward-compat: the pre-rebrand COL- prefix still autolinks (read-only alias)
  // so archived bot posts keep resolving; the token's value is the bare number, so
  // the renderer shows it as the canonical LAB-<n> pill.
  it('matches the legacy COL-<n> alias, and mixed LAB-/COL- refs on one line', () => {
    expect(tokenizeMessage('archived COL-4 still links').filter((x) => x.type === 'issueRef').map((x) => x.value)).toEqual(['4'])
    expect(tokenizeMessage('LAB-1 and COL-2').filter((x) => x.type === 'issueRef').map((x) => x.value)).toEqual(['1', '2'])
  })
  it('captures multiple refs across a line', () => {
    const t = tokenizeMessage('LAB-1 blocks LAB-2')
    expect(t.filter((x) => x.type === 'issueRef').map((x) => x.value)).toEqual(['1', '2'])
  })
  // Regression (F2): the issueRefs pass must run AFTER the link passes so a
  // LAB-<n> living inside a markdown link's label or URL, or inside a bare URL,
  // never splits the link into a stray pill + raw href.
  it('keeps a markdown link whose LABEL contains LAB-n whole (no stray pill)', () => {
    const t = tokenizeMessage('See [LAB-12 spec](https://docs.example.com/spec)')
    const links = t.filter((x) => x.type === 'link')
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ value: 'https://docs.example.com/spec', label: 'LAB-12 spec' })
    // No issue pill, and the raw href is not exposed as literal text.
    expect(t.some((x) => x.type === 'issueRef')).toBe(false)
    expect(t.some((x) => x.type === 'text' && x.value.includes('https://'))).toBe(false)
  })
  it('keeps a markdown link whose URL contains LAB-n whole (no stray pill)', () => {
    const t = tokenizeMessage('[the ticket](https://tracker.example.com/LAB-5)')
    const links = t.filter((x) => x.type === 'link')
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ value: 'https://tracker.example.com/LAB-5', label: 'the ticket' })
    expect(t.some((x) => x.type === 'issueRef')).toBe(false)
  })
  it('does not grow an issue pill from a LAB-n inside a bare URL', () => {
    const t = tokenizeMessage('ref https://tracker.example.com/LAB-5 here')
    expect(t.filter((x) => x.type === 'link').map((x) => x.value)).toEqual(['https://tracker.example.com/LAB-5'])
    expect(t.some((x) => x.type === 'issueRef')).toBe(false)
  })
  it('still tokenizes a plain LAB-n in ordinary text', () => {
    const t = tokenizeMessage('fixed LAB-7 today')
    expect(t.filter((x) => x.type === 'issueRef').map((x) => x.value)).toEqual(['7'])
  })
  it('leaves LAB-n inside inline code untokenized', () => {
    const t = tokenizeMessage('run `LAB-9` please')
    expect(t.some((x) => x.type === 'issueRef')).toBe(false)
    expect(t.some((x) => x.type === 'code' && x.value === 'LAB-9')).toBe(true)
  })
  it('tokenizes a LAB-n adjacent to a mention (mention + ref both survive)', () => {
    const t = tokenizeMessage('<@u_alice> LAB-3')
    expect(t.some((x) => x.type === 'mention' && x.userId === 'u_alice')).toBe(true)
    expect(t.filter((x) => x.type === 'issueRef').map((x) => x.value)).toEqual(['3'])
  })
  it('extractIssueRefNumbers collects distinct word-bounded numbers from free text', () => {
    expect(extractIssueRefNumbers('LAB-7 dupes LAB-7, LABS-1 no, LAB-9 yes')).toEqual([7, 9])
    expect(extractIssueRefNumbers('nothing here')).toEqual([])
  })
})
