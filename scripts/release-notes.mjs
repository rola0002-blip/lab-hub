#!/usr/bin/env node
// release-notes.mjs — print the CHANGELOG.md section for a version as release notes.
// Usage: node scripts/release-notes.mjs <version>   e.g. node scripts/release-notes.mjs v0.20.0
// Exits 1 with a stderr message when the version has no dated section.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Map a git tag name (v0.20.0) to the bare version the CHANGELOG headings use (0.20.0). */
export function normalizeVersion(version) {
  return version.replace(/^v/, '')
}

/** Return the body of CHANGELOG's `## [<version>] - <date>` section, or null. */
export function extractReleaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/)
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`))
  if (start === -1) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => l.startsWith('## ['))
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n')
  const trimmed = body.replace(/^\n+|\n+$/g, '')
  return trimmed.length > 0 ? trimmed : null
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const raw = process.argv[2]
  if (!raw) {
    console.error('usage: node scripts/release-notes.mjs <version>')
    process.exit(2)
  }
  const version = normalizeVersion(raw)
  const notes = extractReleaseNotes(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'), version)
  if (notes === null) {
    console.error(`no dated CHANGELOG section for ${raw}`)
    process.exit(1)
  }
  console.log(notes)
}
