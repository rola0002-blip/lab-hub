// Pure, side-effect-free release helpers — unit-tested in tests/unit/release-lib.test.ts.
// No git, no fs: strings in, strings out. The guarded git/fs wrapper is scripts/release.mjs.

const BUMPS = ['patch', 'minor', 'major']

// Parse "X.Y.Z" or "X.Y.Z-prerelease". Throw on anything else so a release refuses
// ambiguous states (spec §3.3 / §8).
export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v).trim())
  if (!m) throw new Error(`unparseable version: ${JSON.stringify(v)} (expected X.Y.Z or X.Y.Z-prerelease)`)
  return { major: +m[1], minor: +m[2], patch: +m[3], prerelease: m[4] ?? null }
}

// Compute the next version. The one non-obvious rule (spec §3.1): a bump off a
// `-beta` prerelease DROPS the prerelease and increments the requested component from
// the release base — so 0.9.0-beta + patch => 0.9.1 (NOT the semver-default 0.9.0),
// 0.9.0-beta + major => 1.0.0 (graduation). A normal version bumps the usual way.
export function nextVersion(current, bump) {
  if (!BUMPS.includes(bump)) throw new Error(`unknown bump type: ${JSON.stringify(bump)} (use patch|minor|major)`)
  const { major, minor, patch } = parseVersion(current)
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}` // patch: 0.9.0-beta -> 0.9.1, 0.9.1 -> 0.9.2
}

// Roll the `## [Unreleased]` section into a dated `## [version] - date` section,
// leaving a fresh empty `## [Unreleased]` on top. Pure. Throws when Unreleased is
// empty (nothing to release, spec §3.3 step 3) or absent.
export function rollChangelog(text, version, date) {
  const lines = String(text).split('\n')
  const start = lines.findIndex((l) => /^##\s*\[Unreleased\]/i.test(l))
  if (start === -1) throw new Error('CHANGELOG.md has no "## [Unreleased]" section')
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s*\[/.test(lines[i])) { end = i; break }
  }
  const body = lines.slice(start + 1, end)
  if (body.join('').trim() === '') throw new Error('nothing to release: [Unreleased] is empty')
  const trimmed = [...body]
  while (trimmed.length && trimmed[0].trim() === '') trimmed.shift()
  while (trimmed.length && trimmed[trimmed.length - 1].trim() === '') trimmed.pop()
  return [
    ...lines.slice(0, start + 1), // up to & incl. "## [Unreleased]"
    '',                            // fresh empty Unreleased body
    `## [${version}] - ${date}`,
    '',
    ...trimmed,
    '',
    ...lines.slice(end),           // prior version sections (or nothing)
  ].join('\n')
}
