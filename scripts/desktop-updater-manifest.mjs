
// desktop-updater-manifest.mjs -- build latest.json, the Tauri updater
// release manifest (https://v2.tauri.app/plugin/updater/ static server
// format), from a release tag + per-platform artifacts + signatures.
//
// Usage (CI, Task 9's desktop-release.yml):
//   node scripts/desktop-updater-manifest.mjs --tag vX.Y.Z \
//     --asset darwin-aarch64=LabHub_0.21.0_universal.app.tar.gz \
//     --sig    darwin-aarch64=LabHub_0.21.0_universal.app.tar.gz.sig \
//     --asset darwin-x86_64=LabHub_0.21.0_universal.app.tar.gz \
//     --sig    darwin-x86_64=LabHub_0.21.0_universal.app.tar.gz.sig \
//     --asset win-x64=LabHub_0.21.0_x64-setup.exe \
//     --sig    win-x64=LabHub_0.21.0_x64-setup.exe.sig \
//     --notes-file release-notes.md > latest.json
//
//   --asset key=NAME  asset FILE NAME as published on the GitHub release
//                     (goes into the download URL; not a local path)
//   --sig key=FILE    local path to the minisign signature file produced
//                     by `tauri signer sign` (contents are embedded)
//   --notes-file FILE release notes body; defaults to "" when omitted
//   --pub-date DATE   optional pub_date override (RFC 3339); defaults to now
//
// A macOS universal build ships ONE artifact: both darwin keys then point
// at the same asset + signature -- allowed (and unit-tested).
//
// Exit codes: 2 = usage error (bad flags), 1 = bad input (bad tag /
// platform keys / missing pairing / unreadable file). Pure ESM, no deps.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const REPO_DOWNLOAD_BASE = 'https://github.com/rola0002-blip/lab-hub/releases/download'

/** Exactly the targets the desktop app ships (updater.rs target()-style). */
export const ALLOWED_PLATFORMS = ['darwin-aarch64', 'darwin-x86_64', 'win-x64']

/** Usage error -> exit 2 (the CLI contract; see exitCodeFor). */
export class UsageError extends Error {}

/** Bad input error -> exit 1. */
export class InputError extends Error {}

/**
 * Build the manifest object.
 * @param {object} args
 * @param {string} args.tag release tag, e.g. "v0.22.0" (leading v optional)
 * @param {string} [args.pubDate] RFC 3339 timestamp; defaults to now
 * @param {string} [args.notes] release notes body; defaults to ""
 * @param {Record<string, {asset: string, signature: string}>} args.platforms
 *   exactly the three ALLOWED_PLATFORMS keys; a macOS universal build
 *   passes the same asset+signature under both darwin keys
 * @returns {{version: string, notes: string, pub_date: string,
 *   platforms: Record<string, {signature: string, url: string}>}}
 */
export function buildManifest({ tag, pubDate, notes, platforms }) {
  if (typeof tag !== 'string' || !/^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag)) {
    throw new InputError(`tag must look like vX.Y.Z, got: ${JSON.stringify(tag)}`)
  }
  if (platforms === undefined || platforms === null || typeof platforms !== 'object') {
    throw new InputError('platforms object is required')
  }
  for (const key of Object.keys(platforms)) {
    if (!ALLOWED_PLATFORMS.includes(key)) {
      throw new InputError(`unknown platform key ${JSON.stringify(key)} (allowed: ${ALLOWED_PLATFORMS.join(', ')})`)
    }
  }
  for (const key of ALLOWED_PLATFORMS) {
    if (!(key in platforms)) {
      throw new InputError(`missing platform key ${JSON.stringify(key)} (all of ${ALLOWED_PLATFORMS.join(', ')} are required)`)
    }
  }
  const built = {}
  for (const key of ALLOWED_PLATFORMS) {
    const { asset, signature } = platforms[key]
    if (!asset || typeof asset !== 'string') {
      throw new InputError(`platform ${key}: asset file name is required`)
    }
    if (!signature || typeof signature !== 'string') {
      throw new InputError(`platform ${key}: signature is required`)
    }
    built[key] = {
      signature,
      url: `${REPO_DOWNLOAD_BASE}/${tag}/${asset}`,
    }
  }
  return {
    version: tag.replace(/^v/, ''),
    notes: notes ?? '',
    pub_date: pubDate ?? new Date().toISOString(),
    platforms: built,
  }
}

/**
 * Parse CLI arguments (without the node/script prefix).
 * @param {string[]} argv
 * @returns {{tag: string, pubDate?: string, notesFile?: string,
 *   assets: Record<string,string>, sigs: Record<string,string>}}
 *   asset VALUES are file names for the URL; sig VALUES are local paths
 */
export function parseArgs(argv) {
  const assets = {}
  const sigs = {}
  let tag
  let pubDate
  let notesFile
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const consume = (flag) => {
      const value = argv[++i]
      if (value === undefined) throw new UsageError(`${flag} needs a value`)
      return value
    }
    if (arg === '--tag') tag = consume(arg)
    else if (arg === '--pub-date') pubDate = consume(arg)
    else if (arg === '--notes-file') notesFile = consume(arg)
    else if (arg === '--asset' || arg === '--sig') {
      const pair = consume(arg)
      const eq = pair.indexOf('=')
      if (eq === -1) throw new UsageError(`${arg} expects key=file, got: ${JSON.stringify(pair)}`)
      const key = pair.slice(0, eq)
      const file = pair.slice(eq + 1)
      if (!ALLOWED_PLATFORMS.includes(key)) {
        throw new InputError(`unknown platform key ${JSON.stringify(key)} in ${arg} (allowed: ${ALLOWED_PLATFORMS.join(', ')})`)
      }
      ;(arg === '--asset' ? assets : sigs)[key] = file
    } else {
      throw new UsageError(`unknown argument: ${JSON.stringify(arg)}`)
    }
  }
  if (!tag) throw new UsageError('--tag is required')
  if (Object.keys(assets).length === 0 && Object.keys(sigs).length === 0) {
    throw new UsageError('at least one --asset/--sig pair is required')
  }
  for (const key of Object.keys(assets)) {
    if (!(key in sigs)) throw new InputError(`platform ${key}: --asset given without --sig`)
  }
  for (const key of Object.keys(sigs)) {
    if (!(key in assets)) throw new InputError(`platform ${key}: --sig given without --asset`)
  }
  return { tag, pubDate, notesFile, assets, sigs }
}

/** Map an error to the CLI exit code: 2 usage, 1 bad input, 1 anything else. */
export function exitCodeFor(error) {
  return error instanceof UsageError ? 2 : 1
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const { tag, pubDate, notesFile, assets, sigs } = parseArgs(process.argv.slice(2))
    const notes = notesFile === undefined ? '' : readFileSync(notesFile, 'utf8').replace(/\n+$/, '')
    const platforms = {}
    for (const key of ALLOWED_PLATFORMS) {
      if (key in assets) {
        platforms[key] = {
          asset: assets[key],
          signature: readFileSync(sigs[key], 'utf8').trim(),
        }
      }
    }
    console.log(JSON.stringify(buildManifest({ tag, pubDate, notes, platforms }), null, 2))
  } catch (error) {
    console.error(`desktop-updater-manifest: ${error instanceof Error ? error.message : error}`)
    process.exit(exitCodeFor(error))
  }
}
