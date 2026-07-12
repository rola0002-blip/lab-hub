import { describe, it, expect } from 'vitest'
import { tokenizeMessage } from '@/features/chat/markdown'
import { extractIssueRefNumbers } from '@/features/issues/identifier'

describe('issueRef tokenizer pass', () => {
  it('matches word-bounded COL-<n> and leaves code spans alone', () => {
    const t = tokenizeMessage('see COL-42 and `COL-9` plus COLA-1 and COL-x')
    const refs = t.filter((x) => x.type === 'issueRef').map((x) => x.value)
    expect(refs).toEqual(['42'])
    // `COL-9` inside inline code stays a code token; COLA-1 / COL-x never match.
    expect(t.some((x) => x.type === 'code' && x.value === 'COL-9')).toBe(true)
  })
  it('captures multiple refs across a line', () => {
    const t = tokenizeMessage('COL-1 blocks COL-2')
    expect(t.filter((x) => x.type === 'issueRef').map((x) => x.value)).toEqual(['1', '2'])
  })
  // Regression (F2): the issueRefs pass must run AFTER the link passes so a
  // COL-<n> living inside a markdown link's label or URL, or inside a bare URL,
  // never splits the link into a stray pill + raw href.
  it('keeps a markdown link whose LABEL contains COL-n whole (no stray pill)', () => {
    const t = tokenizeMessage('See [COL-12 spec](https://docs.example.com/spec)')
    const links = t.filter((x) => x.type === 'link')
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ value: 'https://docs.example.com/spec', label: 'COL-12 spec' })
    // No issue pill, and the raw href is not exposed as literal text.
    expect(t.some((x) => x.type === 'issueRef')).toBe(false)
    expect(t.some((x) => x.type === 'text' && x.value.includes('https://'))).toBe(false)
  })
  it('keeps a markdown link whose URL contains COL-n whole (no stray pill)', () => {
    const t = tokenizeMessage('[the ticket](https://tracker.example.com/COL-5)')
    const links = t.filter((x) => x.type === 'link')
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ value: 'https://tracker.example.com/COL-5', label: 'the ticket' })
    expect(t.some((x) => x.type === 'issueRef')).toBe(false)
  })
  it('does not grow an issue pill from a COL-n inside a bare URL', () => {
    const t = tokenizeMessage('ref https://tracker.example.com/COL-5 here')
    expect(t.filter((x) => x.type === 'link').map((x) => x.value)).toEqual(['https://tracker.example.com/COL-5'])
    expect(t.some((x) => x.type === 'issueRef')).toBe(false)
  })
  it('still tokenizes a plain COL-n in ordinary text', () => {
    const t = tokenizeMessage('fixed COL-7 today')
    expect(t.filter((x) => x.type === 'issueRef').map((x) => x.value)).toEqual(['7'])
  })
  it('leaves COL-n inside inline code untokenized', () => {
    const t = tokenizeMessage('run `COL-9` please')
    expect(t.some((x) => x.type === 'issueRef')).toBe(false)
    expect(t.some((x) => x.type === 'code' && x.value === 'COL-9')).toBe(true)
  })
  it('tokenizes a COL-n adjacent to a mention (mention + ref both survive)', () => {
    const t = tokenizeMessage('<@u_alice> COL-3')
    expect(t.some((x) => x.type === 'mention' && x.userId === 'u_alice')).toBe(true)
    expect(t.filter((x) => x.type === 'issueRef').map((x) => x.value)).toEqual(['3'])
  })
  it('extractIssueRefNumbers collects distinct word-bounded numbers from free text', () => {
    expect(extractIssueRefNumbers('COL-7 dupes COL-7, COLA-1 no, COL-9 yes')).toEqual([7, 9])
    expect(extractIssueRefNumbers('nothing here')).toEqual([])
  })
})
