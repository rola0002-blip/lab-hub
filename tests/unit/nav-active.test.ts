import { describe, it, expect } from 'vitest'
import { isNavItemActive } from '@/lib/nav-active'

// The real sibling-prefix collision: /issues/me is nested under /issues, so a
// naive startsWith rule lit up both rows. Longest-prefix-wins fixes it.
const HREFS = ['/dashboard', '/chat', '/issues/me', '/issues', '/projects', '/people']

describe('isNavItemActive (longest-prefix-wins)', () => {
  it('/issues → Issues only', () => {
    expect(isNavItemActive('/issues', '/issues', HREFS)).toBe(true)
    expect(isNavItemActive('/issues', '/issues/me', HREFS)).toBe(false)
  })
  it('/issues/me → My issues only', () => {
    expect(isNavItemActive('/issues/me', '/issues/me', HREFS)).toBe(true)
    expect(isNavItemActive('/issues/me', '/issues', HREFS)).toBe(false)
  })
  it('/issues/COL-1 (issue detail) → Issues only', () => {
    expect(isNavItemActive('/issues/COL-1', '/issues', HREFS)).toBe(true)
    expect(isNavItemActive('/issues/COL-1', '/issues/me', HREFS)).toBe(false)
  })
})
