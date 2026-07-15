import { describe, it, expect } from 'vitest'
import { parseVersion, nextVersion, rollChangelog } from '../../scripts/release-lib.mjs'

describe('nextVersion (beta/prerelease rule, spec §3.1)', () => {
  it('drops -beta and increments per bump type', () => {
    expect(nextVersion('0.9.0-beta', 'patch')).toBe('0.9.1') // first trial patch
    expect(nextVersion('0.9.0-beta', 'minor')).toBe('0.10.0')
    expect(nextVersion('0.9.0-beta', 'major')).toBe('1.0.0')  // graduation
  })
  it('bumps a normal (no-prerelease) version the usual way', () => {
    expect(nextVersion('0.9.1', 'patch')).toBe('0.9.2')
    expect(nextVersion('0.9.5', 'minor')).toBe('0.10.0')
    expect(nextVersion('1.4.2', 'major')).toBe('2.0.0')
  })
  it('refuses ambiguous states', () => {
    expect(() => nextVersion('not-a-version', 'patch')).toThrow(/unparseable/)
    expect(() => nextVersion('0.9.1', 'sideways')).toThrow(/bump/)
  })
})

describe('parseVersion', () => {
  it('splits X.Y.Z(-prerelease)', () => {
    expect(parseVersion('0.9.0-beta')).toEqual({ major: 0, minor: 9, patch: 0, prerelease: 'beta' })
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: null })
  })
})

describe('rollChangelog', () => {
  const date = new Date().toISOString().slice(0, 10) // relative, never a hardcoded future date
  const base = [
    '# Changelog', '', '## [Unreleased]', '', '### Added', '- New thing', '',
    '## [0.9.0-beta] - 2026-07-14', '', '### Added', '- Seed', '',
  ].join('\n')

  it('rolls Unreleased into a dated section and leaves a fresh empty Unreleased', () => {
    const out = rollChangelog(base, '0.9.1', date)
    expect(out).toContain(`## [0.9.1] - ${date}`)
    expect(out).toContain('- New thing')                 // content moved into the dated section
    expect(out).toContain('## [0.9.0-beta] - 2026-07-14') // prior section preserved
    // A fresh empty [Unreleased] sits above the new dated section.
    const unreleased = out.slice(out.indexOf('## [Unreleased]'), out.indexOf(`## [0.9.1] - ${date}`))
    expect(unreleased.replace('## [Unreleased]', '').trim()).toBe('')
  })

  it('throws when Unreleased is empty (nothing to release)', () => {
    const empty = ['# Changelog', '', '## [Unreleased]', '', '## [0.9.0-beta] - 2026-07-14', '', '- x', ''].join('\n')
    expect(() => rollChangelog(empty, '0.9.1', date)).toThrow(/nothing to release/)
  })

  it('throws when there is no Unreleased section', () => {
    expect(() => rollChangelog('# Changelog\n\n## [0.9.0-beta] - 2026-07-14\n', '0.9.1', date)).toThrow(/Unreleased/)
  })
})
