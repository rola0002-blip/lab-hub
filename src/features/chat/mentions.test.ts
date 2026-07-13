import { describe, it, expect } from 'vitest'
import { parseMentions, renderBody, neutralizeMentions } from './mentions'

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

describe('neutralizeMentions', () => {
  // The bot must never @-mention (spec §5.4). Neutralizing must leave NO token
  // parseMentions can match, so a channel/user token injected via user-controlled
  // text (issue titles, project/document/user names) can never make the trusted,
  // rate-limit-exempt bot bell the workspace or a chosen user.
  it('breaks channel and user tokens while keeping the text readable', () => {
    expect(neutralizeMentions('<!channel> URGENT: sign in')).toBe('#channel URGENT: sign in')
    expect(neutralizeMentions('ping <@u1> and <@u2-x>')).toBe('ping @u1 and @u2-x')
    expect(neutralizeMentions('plain text, no tokens')).toBe('plain text, no tokens')
  })
  it('a neutralized body parses to ZERO mentions (channel + user + nested/adversarial)', () => {
    for (const s of [
      '<!channel>', '<@abc>', 'a <@x> b <!channel> c',
      '<@a<!channel>x>', '<@x<@abc>>', '<@<@a>>', '<!channel><!channel>',
    ]) {
      const r = parseMentions(neutralizeMentions(s))
      expect(r.channel).toBe(false)
      expect(r.userIds).toEqual([])
    }
  })
})
