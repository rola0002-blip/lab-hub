import { describe, it, expect } from 'vitest'
import { isValidElement, type ReactNode } from 'react'
import { renderExcerpt } from '@/components/chat/search-box'

// Flatten a ReactNode tree to its visible text (string leaves only). Enough to
// assert what a compact search excerpt renders without a DOM.
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children)
  return ''
}

describe('renderExcerpt (F3 — chat search snippet)', () => {
  const names = new Map<string, string>([['u_alice', 'Alice']])

  it('restores the LAB- prefix instead of printing the bare number', () => {
    // Pre-fix this rendered "Fixed 5 yesterday" (the prefix was consumed by the match).
    expect(textOf(renderExcerpt('Fixed LAB-5 yesterday', names, []))).toBe('Fixed LAB-5 yesterday')
  })

  it('renders multiple issue refs with their prefixes', () => {
    expect(textOf(renderExcerpt('LAB-1 blocks LAB-2', names, []))).toBe('LAB-1 blocks LAB-2')
  })

  it('still renders mentions and plain text around a ref', () => {
    expect(textOf(renderExcerpt('<@u_alice> see LAB-9', names, []))).toBe('@Alice see LAB-9')
  })

  // Backward-compat: an archived post containing the legacy COL- prefix re-renders
  // with the canonical LAB- prefix (the token carries only the bare number).
  it('re-renders a legacy COL- ref with the canonical LAB- prefix', () => {
    expect(textOf(renderExcerpt('Fixed COL-5 yesterday', names, []))).toBe('Fixed LAB-5 yesterday')
  })
})
