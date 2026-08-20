import { describe, expect, it } from 'vitest'
import { extractReleaseNotes, normalizeVersion } from '../../scripts/release-notes.mjs'

const CHANGELOG = `# Changelog

## [Unreleased]

## [v0.20.0] - 2026-08-20

### Fixed

- Bare-keypress hotkeys.

## [v0.19.0] - 2026-08-19

### Added

- Something else.
`

describe('extractReleaseNotes', () => {
  it('returns the body of the named version section', () => {
    expect(extractReleaseNotes(CHANGELOG, 'v0.20.0')).toBe(
      '### Fixed\n\n- Bare-keypress hotkeys.',
    )
  })

  it('returns null for an unknown version', () => {
    expect(extractReleaseNotes(CHANGELOG, 'v9.9.9')).toBeNull()
  })

  it('returns null for the Unreleased section (not a release)', () => {
    expect(extractReleaseNotes(CHANGELOG, 'Unreleased')).toBeNull()
  })
})

describe('normalizeVersion', () => {
  it('strips one leading v from tag names', () => {
    expect(normalizeVersion('v0.20.0')).toBe('0.20.0')
    expect(normalizeVersion('0.20.0')).toBe('0.20.0')
  })
})
