import { describe, it, expect } from 'vitest'
import { tokenizeMessage, messageToPlainText, type Token } from '@/features/chat/markdown'

const types = (ts: Token[]) => ts.map((t) => t.type)

describe('tokenizeMessage — inline emphasis & code', () => {
  it('tokenizes bold, italic, strike, and inline code', () => {
    const t = tokenizeMessage('a **b** _c_ ~d~ `e`')
    expect(types(t)).toEqual(expect.arrayContaining(['text', 'bold', 'italic', 'strike', 'code']))
    expect(t.find((x) => x.type === 'bold')?.value).toBe('b')
    expect(t.find((x) => x.type === 'italic')?.value).toBe('c')
    expect(t.find((x) => x.type === 'strike')?.value).toBe('d')
    expect(t.find((x) => x.type === 'code')?.value).toBe('e')
  })

  it('does not italicize underscores inside a word (snake_case)', () => {
    const t = tokenizeMessage('snake_case_name')
    expect(types(t)).toEqual(['text'])
    expect(t[0].value).toBe('snake_case_name')
  })
})

describe('tokenizeMessage — emoji', () => {
  it('resolves emoji shortnames to glyphs', () => {
    const t = tokenizeMessage('party :tada: time')
    expect(t.find((x) => x.type === 'emoji')?.value).toBe('🎉')
  })
  it('leaves unknown shortnames as literal text', () => {
    const t = tokenizeMessage(':definitely_nope:')
    expect(types(t)).toEqual(['text'])
    expect(t[0].value).toBe(':definitely_nope:')
  })
  it('tokenizes raw unicode emoji individually', () => {
    const t = tokenizeMessage('🎉🎉')
    expect(types(t)).toEqual(['emoji', 'emoji'])
    expect(t.every((x) => x.value === '🎉')).toBe(true)
  })
})

describe('tokenizeMessage — mentions & links (subsumes renderTokens)', () => {
  it('parses user mentions carrying the userId', () => {
    const t = tokenizeMessage('hi <@u1> there')
    const m = t.find((x) => x.type === 'mention')
    expect(m?.userId).toBe('u1')
  })
  it('parses channel mentions', () => {
    expect(types(tokenizeMessage('ping <!channel>'))).toContain('channel')
  })
  it('parses bare URLs as links', () => {
    const t = tokenizeMessage('see https://example.com/x now')
    expect(t.find((x) => x.type === 'link')?.value).toBe('https://example.com/x')
  })
})

describe('tokenizeMessage — markdown [text](url) links (Task 14 fix)', () => {
  it('parses a scheme-locked [text](url) link carrying href + label', () => {
    const t = tokenizeMessage('[docs](https://x.com)')
    expect(types(t)).toEqual(['link'])
    expect(t.find((x) => x.type === 'link')).toMatchObject({ value: 'https://x.com', label: 'docs' })
    // The greedy bare-URL swallow is gone: no leftover literal ")".
    expect(t.some((x) => x.value.includes(')'))).toBe(false)
  })

  it('falls back to the url as text when the label is empty', () => {
    const t = tokenizeMessage('[](https://x.com)')
    expect(types(t)).toEqual(['link'])
    const link = t.find((x) => x.type === 'link')!
    expect(link.value).toBe('https://x.com')
    expect(link.label ?? link.value).toBe('https://x.com')
  })

  it('does NOT emit a link for a javascript: scheme markdown link (XSS guard)', () => {
    const t = tokenizeMessage('[x](javascript:alert(1))')
    // Security: never a link token, never a javascript: href.
    expect(t.find((x) => x.type === 'link')).toBeUndefined()
    expect(t.some((x) => x.type === 'link' && /^javascript:/i.test(x.value))).toBe(false)
    // The whole marker survives as literal, React-escaped text.
    expect(t.map((x) => x.value).join('')).toBe('[x](javascript:alert(1))')
  })

  it('does NOT emit a link for a relative-path markdown link', () => {
    const t = tokenizeMessage('[home](/dashboard)')
    expect(t.find((x) => x.type === 'link')).toBeUndefined()
    expect(t.map((x) => x.value).join('')).toBe('[home](/dashboard)')
  })

  it('trims a trailing ) from a bare URL so it is not swallowed', () => {
    const t = tokenizeMessage('(see https://x.com)')
    expect(t.find((x) => x.type === 'link')?.value).toBe('https://x.com')
    expect(t.map((x) => x.value).join('')).toBe('(see https://x.com)')
  })

  it('trims trailing sentence punctuation from a bare URL', () => {
    expect(tokenizeMessage('read https://x.com.').find((x) => x.type === 'link')?.value).toBe('https://x.com')
    expect(tokenizeMessage('read https://x.com, ok').find((x) => x.type === 'link')?.value).toBe('https://x.com')
  })
})

describe('tokenizeMessage — code fences extracted first', () => {
  it('extracts a single-line fence as one codeblock token', () => {
    const t = tokenizeMessage('```code```')
    expect(types(t)).toEqual(['codeblock'])
    expect(t[0].value).toBe('code')
  })
  it('does NOT parse markdown or mentions inside a fence', () => {
    const t = tokenizeMessage('```**b** <@u1> :tada:```')
    expect(types(t)).toEqual(['codeblock'])
    expect(t[0].value).toContain('<@u1>')
    expect(t[0].value).toContain('**b**')
  })
  it('strips a leading language line from a multi-line fence', () => {
    const t = tokenizeMessage('```js\nconst x = 1\n```')
    expect(types(t)).toEqual(['codeblock'])
    expect(t[0].value).toBe('const x = 1')
  })
  it('does NOT parse markdown inside inline code', () => {
    const t = tokenizeMessage('`**b** <@u1>`')
    expect(types(t)).toEqual(['code'])
    expect(t[0].value).toBe('**b** <@u1>')
  })
})

describe('tokenizeMessage — block prefixes', () => {
  it('parses a > quote line', () => {
    const t = tokenizeMessage('> quoted')
    expect(types(t)).toEqual(['quote'])
    expect(t[0].value).toBe('quoted')
  })
  it('parses a - list item', () => {
    const t = tokenizeMessage('- item')
    expect(types(t)).toEqual(['listitem'])
    expect(t[0].value).toBe('item')
  })
})

describe('tokenizeMessage — plain text is unchanged', () => {
  it('returns a single text token for plain text', () => {
    expect(tokenizeMessage('hello from A')).toEqual([{ type: 'text', value: 'hello from A' }])
  })
  it('preserves newlines between plain lines', () => {
    const t = tokenizeMessage('line1\nline2')
    expect(t.map((x) => x.value).join('')).toBe('line1\nline2')
  })
  it('returns an empty array for an empty body', () => {
    expect(tokenizeMessage('')).toEqual([])
  })
})

describe('messageToPlainText — screen-reader flattening', () => {
  it('returns plain text unchanged (trimmed)', () => {
    expect(messageToPlainText('hello from A')).toBe('hello from A')
  })
  it('strips emphasis / inline-code markers, keeping the inner text', () => {
    expect(messageToPlainText('a **b** _c_ ~d~ `e`')).toBe('a b c d e')
  })
  it('collapses newlines into a single spoken line', () => {
    expect(messageToPlainText('line1\nline2')).toBe('line1 line2')
  })
  it('speaks a code fence body without the backticks', () => {
    expect(messageToPlainText('```js\nconst x = 1\n```')).toBe('const x = 1')
  })
  it('announces a link by its label, never the raw href', () => {
    expect(messageToPlainText('see [docs](https://x.com) now')).toBe('see docs now')
  })
  it('announces a bare URL as its url text', () => {
    expect(messageToPlainText('read https://x.com/a')).toBe('read https://x.com/a')
  })
  it('resolves a user mention to a readable @name', () => {
    expect(messageToPlainText('hi <@u1> there', (id) => (id === 'u1' ? 'Bob' : undefined))).toBe('hi @Bob there')
  })
  it('falls back to a generic @mention when the user is unknown', () => {
    expect(messageToPlainText('hi <@u1>')).toBe('hi @mention')
  })
  it('renders a channel mention as @channel', () => {
    expect(messageToPlainText('heads up <!channel>')).toBe('heads up @channel')
  })
  it('returns an empty string for an empty or attachment-only body', () => {
    expect(messageToPlainText('')).toBe('')
  })
})
