import { describe, it, expect } from 'vitest'
import { parseCollapsed, serializeCollapsed } from './board-collapse'

describe('parseCollapsed', () => {
  it('defaults to Canceled collapsed when unset', () => {
    expect([...parseCollapsed(null)]).toEqual(['CANCELED'])
  })
  it('round-trips a serialized set', () => {
    const s = new Set(['BACKLOG', 'DONE'] as const)
    expect([...parseCollapsed(serializeCollapsed(s))].sort()).toEqual(['BACKLOG', 'DONE'])
  })
  it('treats an explicit empty array as all-expanded, not the default', () => {
    expect(parseCollapsed('[]').size).toBe(0)
  })
  it('drops unknown entries but keeps valid ones', () => {
    expect([...parseCollapsed('["CANCELED","NOT_A_STATUS",42]')]).toEqual(['CANCELED'])
  })
  it('falls back to the default on unparseable or non-array input', () => {
    expect([...parseCollapsed('{not json')]).toEqual(['CANCELED'])
    expect([...parseCollapsed('"DONE"')]).toEqual(['CANCELED'])
    expect([...parseCollapsed('{"a":1}')]).toEqual(['CANCELED'])
  })
})

describe('serializeCollapsed', () => {
  it('serializes to a JSON array', () => {
    expect(JSON.parse(serializeCollapsed(new Set(['TODO'] as const)))).toEqual(['TODO'])
    expect(JSON.parse(serializeCollapsed(new Set()))).toEqual([])
  })
})
