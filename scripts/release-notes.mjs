#!/usr/bin/env node
// release-notes.mjs — print the CHANGELOG.md section for a version as release notes.
// Usage: node scripts/release-notes.mjs <version>   e.g. node scripts/release-notes.mjs v0.20.0
// Exits 1 with a stderr message when the version has no dated section.
import { readFileSync } from 'node:fs'

/** Return the body of CHANGELOG's `## [<version>] - <date>` section, or null. */
export function extractReleaseNotes(changelog, version) {
  const lines = changelog.split('\n')
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`))
  if (start === -1) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => l.startsWith('## ['))
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n')
  const trimmed = body.replace(/^\n+|\n+$/g, '')
  return trimmed.length > 0 ? trimmed : null
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const version = process.argv[2]
  if (!version) {
    console.error('usage: node scripts/release-notes.mjs <version>')
    process.exit(2)
  }
  const notes = extractReleaseNotes(readFileSync('CHANGELOG.md', 'utf8'), version)
  if (notes === null) {
    console.error(`no dated CHANGELOG section for ${version}`)
    process.exit(1)
  }
  console.log(notes)
}
