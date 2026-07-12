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
  it('extractIssueRefNumbers collects distinct word-bounded numbers from free text', () => {
    expect(extractIssueRefNumbers('COL-7 dupes COL-7, COLA-1 no, COL-9 yes')).toEqual([7, 9])
    expect(extractIssueRefNumbers('nothing here')).toEqual([])
  })
})
