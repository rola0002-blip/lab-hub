import { describe, expect, it } from 'vitest'
import {
  ALLOWED_PLATFORMS,
  InputError,
  UsageError,
  buildManifest,
  exitCodeFor,
  parseArgs,
} from '../../scripts/desktop-updater-manifest.mjs'

const SIG_A = 'dW5pdmVyc2FsLXNpZy1h'
const SIG_W = 'd2luLXNpZw=='
const PUB_DATE = '2026-08-21T00:00:00Z'

function fullPlatforms(overrides = {}) {
  return {
    'darwin-aarch64': { asset: 'LabHub_0.21.0_universal.app.tar.gz', signature: SIG_A },
    'darwin-x86_64': { asset: 'LabHub_0.21.0_universal.app.tar.gz', signature: SIG_A },
    'win-x64': { asset: 'LabHub_0.21.0_x64-setup.exe', signature: SIG_W },
    ...overrides,
  }
}

describe('buildManifest', () => {
  it('strips the leading v from the tag for version', () => {
    const m = buildManifest({ tag: 'v0.22.0', pubDate: PUB_DATE, platforms: fullPlatforms() })
    expect(m.version).toBe('0.22.0')
  })

  it('keeps a bare version tag as-is', () => {
    const m = buildManifest({ tag: '0.22.0', pubDate: PUB_DATE, platforms: fullPlatforms() })
    expect(m.version).toBe('0.22.0')
  })

  it('rejects non-semver tags', () => {
    expect(() => buildManifest({ tag: 'latest', platforms: fullPlatforms() })).toThrow(InputError)
    expect(() => buildManifest({ tag: 'v1.2', platforms: fullPlatforms() })).toThrow(InputError)
  })

  it('builds the per-platform download URLs from tag + asset name', () => {
    const m = buildManifest({ tag: 'v0.22.0', pubDate: PUB_DATE, platforms: fullPlatforms() })
    expect(m.platforms['darwin-aarch64'].url).toBe(
      'https://github.com/rola0002-blip/lab-hub/releases/download/v0.22.0/LabHub_0.21.0_universal.app.tar.gz',
    )
    expect(m.platforms['win-x64'].url).toBe(
      'https://github.com/rola0002-blip/lab-hub/releases/download/v0.22.0/LabHub_0.21.0_x64-setup.exe',
    )
  })

  it('passes notes through verbatim (multiline markdown)', () => {
    const notes = '### Fixed\n\n- Tray badge lag.\n- Updater relaunch.'
    const m = buildManifest({ tag: 'v0.22.0', pubDate: PUB_DATE, notes, platforms: fullPlatforms() })
    expect(m.notes).toBe(notes)
  })

  it('defaults notes to an empty string and pub_date to an RFC 3339 timestamp', () => {
    const m = buildManifest({ tag: 'v0.22.0', platforms: fullPlatforms() })
    expect(m.notes).toBe('')
    expect(m.pub_date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('passes an explicit pub_date through unchanged', () => {
    const m = buildManifest({ tag: 'v0.22.0', pubDate: PUB_DATE, platforms: fullPlatforms() })
    expect(m.pub_date).toBe(PUB_DATE)
  })

  it('allows both darwin keys to share one asset+signature (universal dmg)', () => {
    const m = buildManifest({ tag: 'v0.22.0', pubDate: PUB_DATE, platforms: fullPlatforms() })
    expect(m.platforms['darwin-aarch64']).toEqual(m.platforms['darwin-x86_64'])
    expect(m.platforms['darwin-aarch64'].url).toBe(m.platforms['darwin-x86_64'].url)
  })

  it('errors when a platform key is missing', () => {
    const platforms = fullPlatforms()
    delete platforms['win-x64']
    expect(() => buildManifest({ tag: 'v0.22.0', platforms })).toThrow(InputError)
    expect(() => buildManifest({ tag: 'v0.22.0', platforms })).toThrow(/win-x64/)
  })

  it('errors on unknown platform keys', () => {
    expect(() =>
      buildManifest({
        tag: 'v0.22.0',
        platforms: fullPlatforms({ 'linux-x86_64': { asset: 'a.AppImage', signature: 's' } }),
      }),
    ).toThrow(InputError)
  })

  it('requires the asset+signature pair on every platform', () => {
    expect(() =>
      buildManifest({
        tag: 'v0.22.0',
        platforms: fullPlatforms({ 'win-x64': { asset: 'x.exe', signature: '' } }),
      }),
    ).toThrow(InputError)
    expect(() =>
      buildManifest({
        tag: 'v0.22.0',
        platforms: fullPlatforms({ 'darwin-aarch64': { signature: SIG_A } }),
      }),
    ).toThrow(InputError)
  })
})

describe('parseArgs', () => {
  const FULL = [
    '--tag', 'v0.22.0',
    '--asset', 'darwin-aarch64=uni.app.tar.gz',
    '--sig', 'darwin-aarch64=uni.app.tar.gz.sig',
    '--asset', 'darwin-x86_64=uni.app.tar.gz',
    '--sig', 'darwin-x86_64=uni.app.tar.gz.sig',
    '--asset', 'win-x64=setup.exe',
    '--sig', 'win-x64=setup.exe.sig',
    '--notes-file', 'release-notes.md',
  ]

  it('collects repeated --asset/--sig flags into per-platform maps', () => {
    const { assets, sigs } = parseArgs(FULL)
    expect(assets).toEqual({
      'darwin-aarch64': 'uni.app.tar.gz',
      'darwin-x86_64': 'uni.app.tar.gz',
      'win-x64': 'setup.exe',
    })
    expect(sigs['win-x64']).toBe('setup.exe.sig')
  })

  it('captures --tag, --notes-file and optional --pub-date', () => {
    const parsed = parseArgs([...FULL, '--pub-date', PUB_DATE])
    expect(parsed.tag).toBe('v0.22.0')
    expect(parsed.notesFile).toBe('release-notes.md')
    expect(parsed.pubDate).toBe(PUB_DATE)
    expect(parseArgs(FULL).pubDate).toBeUndefined()
  })

  it('throws UsageError (exit 2) for a missing --tag', () => {
    expect(() => parseArgs(FULL.slice(2))).toThrow(UsageError)
    expect(() => parseArgs([])).toThrow(UsageError)
  })

  it('throws UsageError for unknown flags or malformed key=file pairs', () => {
    expect(() => parseArgs([...FULL, '--verbose'])).toThrow(UsageError)
    expect(() => parseArgs(['--tag', 'v0.22.0', '--asset', 'no-equals-sign'])).toThrow(UsageError)
    expect(() => parseArgs(['--tag', 'v0.22.0', '--asset'])).toThrow(UsageError)
  })

  it('throws InputError (exit 1) for platform keys outside the allowed three', () => {
    expect(() => parseArgs(['--tag', 'v0.22.0', '--asset', 'linux-x86_64=a.AppImage'])).toThrow(InputError)
  })

  it('throws InputError when an asset has no sig or vice versa', () => {
    expect(() =>
      parseArgs(['--tag', 'v0.22.0', '--asset', 'win-x64=setup.exe', '--sig', 'win-x64=s.sig', '--asset', 'darwin-aarch64=uni.tar.gz']),
    ).toThrow(InputError)
    expect(() =>
      parseArgs(['--tag', 'v0.22.0', '--asset', 'win-x64=setup.exe', '--sig', 'win-x64=s.sig', '--sig', 'darwin-aarch64=u.sig']),
    ).toThrow(InputError)
  })

  it('accepts exactly the three allowed platform keys', () => {
    expect(ALLOWED_PLATFORMS).toEqual(['darwin-aarch64', 'darwin-x86_64', 'win-x64'])
  })
})

describe('exitCodeFor', () => {
  it('maps UsageError to 2 and everything else to 1', () => {
    expect(exitCodeFor(new UsageError('bad flags'))).toBe(2)
    expect(exitCodeFor(new InputError('bad tag'))).toBe(1)
    expect(exitCodeFor(new Error('boom'))).toBe(1)
  })
})
