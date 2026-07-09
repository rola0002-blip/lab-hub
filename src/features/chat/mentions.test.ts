import { describe, it, expect } from 'vitest'
import { parseMentions, renderBody } from './mentions'

describe('parseMentions', () => {
  it('extracts unique user ids and channel flag', () => {
    const r = parseMentions('hey <@u1> and <@u2> and <@u1> — <!channel> meeting')
    expect(r.userIds).toEqual(['u1', 'u2'])
    expect(r.channel).toBe(true)
  })
  it('returns empty for plain text and ignores malformed tokens', () => {
    expect(parseMentions('no mentions <@ > <@>')).toEqual({ userIds: [], channel: false })
  })
})

describe('renderBody', () => {
  it('replaces tokens with display names and @channel', () => {
    const names = new Map([['u1', 'Roland']])
    expect(renderBody('hi <@u1>, <@u9> — <!channel>', names)).toBe('hi @Roland, @unknown — @channel')
  })
})
