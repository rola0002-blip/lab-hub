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
  it('/issues/LAB-1 (issue detail) → Issues only', () => {
    expect(isNavItemActive('/issues/LAB-1', '/issues', HREFS)).toBe(true)
    expect(isNavItemActive('/issues/LAB-1', '/issues/me', HREFS)).toBe(false)
  })
  // W21-C: sidebar pinned rows join the href list, so a pinned project's page
  // lights ONLY its pinned row; an unpinned project page still lights Projects.
  it('/projects/p1 → the pinned row only when pinned; Projects otherwise', () => {
    const withPin = [...HREFS, '/projects/p1']
    expect(isNavItemActive('/projects/p1', '/projects/p1', withPin)).toBe(true)
    expect(isNavItemActive('/projects/p1', '/projects', withPin)).toBe(false)
    expect(isNavItemActive('/projects/p2', '/projects', withPin)).toBe(true)
    expect(isNavItemActive('/projects/p1', '/projects', HREFS)).toBe(true)
  })
})
