import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import manifest from './manifest'

// PWA completion (spec S1): install identity, dark boot, shortcuts.
describe('web app manifest', () => {
  const m = manifest()

  it('pins install identity: id + scope + standalone', () => {
    expect(m.id).toBe('/')
    expect(m.scope).toBe('/')
    expect(m.display).toBe('standalone')
    expect(m.orientation).toBe('any')
  })

  it('boots dark — no white splash on dark devices', () => {
    expect(m.background_color).toBe('#1a1d21')
  })

  it('ships any + maskable icons at 192 and 512', () => {
    const sizes = (m.icons ?? []).map((i) => `${String(i.sizes).toLowerCase()}:${(i.purpose ?? 'any').toLowerCase()}`)
    expect(sizes).toContain('192x192:any')
    expect(sizes).toContain('512x512:any')
    expect(sizes).toContain('512x512:maskable')
  })

  it('references icon files that actually exist in public/', () => {
    for (const i of m.icons ?? []) {
      const p = join(__dirname, '../../public', i.src.replace(/^\//, ''))
      expect(existsSync(p)).toBe(true)
    }
  })

  it('shortcuts target real routes', () => {
    expect((m.shortcuts ?? []).map((s) => new URL(s.url, 'https://lab.test').pathname)).toEqual(['/chat', '/booking', '/issues'])
  })
})
