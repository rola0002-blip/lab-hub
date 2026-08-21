#!/usr/bin/env node
// Cut a release: bump package.json version (per the beta/prerelease rule), roll
// CHANGELOG.md's [Unreleased] into a dated section, commit, and create an annotated
// tag. It NEVER pushes — it prints the exact push command for the operator to run
// after review (spec §3.3). Pure logic is in ./release-lib.mjs (unit-tested); this
// wrapper is the thin, guarded git/fs layer, verified via --dry-run.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { nextVersion, rollChangelog } from './release-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = join(ROOT, 'package.json')
const CHANGELOG = join(ROOT, 'CHANGELOG.md')
const PUSH_CMD = 'git push origin main --follow-tags'

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
const fail = (msg) => { console.error(`release: ${msg}`); process.exit(1) }
const today = () => new Date().toISOString().slice(0, 10) // YYYY-MM-DD (UTC)

export function main(argv) {
  const args = argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const bump = args.find((a) => !a.startsWith('-'))
  if (!bump) fail('usage: node scripts/release.mjs patch|minor|major [--dry-run]')

  const pkg = JSON.parse(readFileSync(PKG, 'utf8'))
  const current = pkg.version
  const next = nextVersion(current, bump) // throws on ambiguous/unknown → aborts

  if (dryRun) {
    // Preview only: pure math + intended commands, from ANY branch/state. No writes,
    // no git mutations. Env guards belong to the mutating path (below), so a dry-run
    // never fails on branch/tree/Unreleased state — it just reports it.
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
    console.log('DRY RUN — no files or git refs changed.')
    console.log(`current version: ${current}`)
    console.log(`next version:    ${next}`)
    console.log(`would commit:    release: v${next}`)
    console.log(`would tag:       v${next} (annotated)`)
    if (branch !== 'main') console.log(`note: on branch "${branch}" — a real run refuses anything but main.`)
    try { rollChangelog(readFileSync(CHANGELOG, 'utf8'), next, today()) }
    catch (e) { console.log(`note: ${e.message} — a real run would abort here.`) }
    console.log(`after review, push with:\n  ${PUSH_CMD}`)
    return
  }

  // --- real run: hard guards (spec §3.3 steps 1 + 3) ---
  if (git(['status', '--porcelain']) !== '') fail('working tree is not clean — commit or stash first')
  if (git(['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') fail('releases are cut from main only')

  const rolled = rollChangelog(readFileSync(CHANGELOG, 'utf8'), next, today()) // throws → aborts if Unreleased empty

  pkg.version = next
  writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n') // preserve 2-space indent
  writeFileSync(CHANGELOG, rolled)

  // Desktop app version sync (SP11): desktop/src-tauri's build.rs asserts all
  // three files carry the same version — bump them here so the release commit
  // is complete and the desktop CI never trips on a version skew.
  const CARGO = 'desktop/src-tauri/Cargo.toml'
  const CONF = 'desktop/src-tauri/tauri.conf.json'
  const cargo = readFileSync(CARGO, 'utf8').replace(
    /^version\s*=\s*"[^"]*"/m,
    `version = "${next}"`,
  )
  const conf = JSON.parse(readFileSync(CONF, 'utf8'))
  conf.version = next
  writeFileSync(CARGO, cargo)
  writeFileSync(CONF, JSON.stringify(conf, null, 2) + '\n')
  // Cargo.lock pins the crate's own version — refresh it or `--locked` builds fail.
  execFileSync('cargo', ['update', '--manifest-path', CARGO, '-p', 'labhub-desktop', '--offline'], { stdio: 'pipe' })

  git(['add', 'package.json', 'CHANGELOG.md', CARGO, CONF, 'desktop/src-tauri/Cargo.lock'])
  git(['commit', '-m', `release: v${next}`])
  git(['tag', '-a', `v${next}`, '-m', `v${next}`])

  console.log(`Released v${next}: committed + annotated tag. Nothing was pushed.`)
  console.log(`Review the commit + tag, then push with:\n  ${PUSH_CMD}`)
}

// Run only when executed directly (node scripts/release.mjs …), never when imported.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv)
