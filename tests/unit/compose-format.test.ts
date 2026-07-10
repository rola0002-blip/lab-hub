import { describe, it, expect } from 'vitest'
import { wrapSelection, detectTrigger } from '@/features/chat/compose-format'

describe('compose-format', () => {
  it('wraps a selection with markers', () => {
    const r = wrapSelection('hello world', 6, 11, '**')
    expect(r.value).toBe('hello **world**')
  })
  it('detects an emoji trigger', () => {
    expect(detectTrigger('hi :ta', 6, ':')).toEqual({ query: 'ta', from: 3 })
    expect(detectTrigger('hi there', 8, ':')).toBeNull()
  })

  it('keeps the wrapped text selected between symmetric markers', () => {
    const r = wrapSelection('hello world', 6, 11, '**')
    expect([r.selStart, r.selEnd]).toEqual([8, 13])
    expect(r.value.slice(r.selStart, r.selEnd)).toBe('world')
  })

  it('inserts empty symmetric markers with the caret between them', () => {
    const r = wrapSelection('ab', 1, 1, '`')
    expect(r.value).toBe('a``b')
    expect([r.selStart, r.selEnd]).toEqual([2, 2])
  })

  it('builds a link with the url placeholder selected', () => {
    const r = wrapSelection('see docs', 4, 8, '[]()')
    expect(r.value).toBe('see [docs](url)')
    expect(r.value.slice(r.selStart, r.selEnd)).toBe('url')
  })

  it('seeds link label text when nothing is selected', () => {
    const r = wrapSelection('', 0, 0, '[]()')
    expect(r.value).toBe('[text](url)')
    expect(r.value.slice(r.selStart, r.selEnd)).toBe('url')
  })

  it('prefixes the current line for list and quote markers', () => {
    expect(wrapSelection('one\ntwo', 4, 7, '- ').value).toBe('one\n- two')
    expect(wrapSelection('one\ntwo', 4, 7, '> ').value).toBe('one\n> two')
  })

  it('generalizes mention detection via the @ trigger', () => {
    expect(detectTrigger('hey @ro', 7, '@')).toEqual({ query: 'ro', from: 4 })
    expect(detectTrigger('@ro', 3, '@')).toEqual({ query: 'ro', from: 0 })
  })

  it('rejects a trigger that is not at a word boundary', () => {
    // `@` glued to a preceding non-space char (e.g. an email) is not a mention.
    expect(detectTrigger('mail@ro', 7, '@')).toBeNull()
    // No trigger char before the caret at all.
    expect(detectTrigger('plain', 5, ':')).toBeNull()
  })
})
