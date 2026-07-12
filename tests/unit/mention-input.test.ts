import { describe, it, expect } from 'vitest'
import { mentionQueryAt, insertMention, moveActive } from '@/features/issues/mention-input'

// F5: the @-mention autocomplete keyboard flow. These pin the pure logic the
// IssueMentionInput drives from its textarea onKeyDown (nav) + pick (insertion).

describe('mentionQueryAt', () => {
  it('extracts the @word immediately left of the caret', () => {
    expect(mentionQueryAt('hi @ali', 7)).toBe('ali')
    expect(mentionQueryAt('@', 1)).toBe('') // "@" with no chars yet → match everyone
  })
  it('is null when the caret is not inside a mention', () => {
    expect(mentionQueryAt('hi @ali there', 13)).toBeNull() // caret after a space closes the query
    expect(mentionQueryAt('plain text', 10)).toBeNull()
  })
})

describe('insertMention', () => {
  it('replaces the trailing @query with the <@id> token and returns the caret after it', () => {
    const { value, caret } = insertMention('ping @al', 8, 'user-1')
    expect(value).toBe('ping <@user-1> ')
    expect(caret).toBe('ping <@user-1> '.length)
  })
  it('preserves text to the right of the caret', () => {
    const { value } = insertMention('ping @al and thanks', 8, 'u2')
    expect(value).toBe('ping <@u2>  and thanks')
  })
  it('inserts a full <@id> token a keyboard user could never type by hand', () => {
    expect(insertMention('@', 1, 'cuid_xyz').value).toBe('<@cuid_xyz> ')
  })
})

describe('moveActive (arrow navigation, wrap-around)', () => {
  it('ArrowDown advances and wraps at the end', () => {
    expect(moveActive(0, 'ArrowDown', 3)).toBe(1)
    expect(moveActive(2, 'ArrowDown', 3)).toBe(0)
  })
  it('ArrowUp retreats and wraps at the start', () => {
    expect(moveActive(0, 'ArrowUp', 3)).toBe(2)
    expect(moveActive(1, 'ArrowUp', 3)).toBe(0)
  })
  it('clamps a stale index into range before moving (shrunk match list)', () => {
    expect(moveActive(5, 'ArrowDown', 3)).toBe(0) // clamp 5→2, then +1 wraps to 0
    expect(moveActive(5, 'ArrowUp', 3)).toBe(1)   // clamp 5→2, then -1
  })
  it('never moves past an empty list', () => {
    expect(moveActive(0, 'ArrowDown', 0)).toBe(0)
  })
})
