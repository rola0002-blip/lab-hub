#!/usr/bin/env node
// WCAG contrast gate for the COLOSSUS design tokens. Run via `npm run contrast`.
//
// It computes the WCAG 2.x contrast ratio for the critical token pairs in BOTH
// themes and for every accent preset, and exits non-zero on any failure. The
// intent is a CI floor that fails the build if a token nudge (or a new accent)
// silently drops a pair below its bar — the automated companion to the axe-core
// e2e sweep.
//
// Sources of truth:
//  - Accent hexes are parsed straight from `src/lib/accents.ts` (never duplicated
//    here) so adding/retuning a preset is caught automatically.
//  - The base semantic values are the resolved light/dark tokens from
//    `src/app/globals.css` §2/§3, cited inline; this script is the gate, not the
//    source, so they are enumerated rather than re-parsed through var()/color-mix.
//
// Thresholds: text pairs use the AA normal-text bar (4.5:1); UI-component /
// non-text pairs (button label on its fill, focus ring on canvas) use the
// adjudicated 3:1 non-text bar — the brand teal button ships white-on-teal-600
// at ~3.7:1 and is approved, so 3:1 (not 4.5:1) is binding for those.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── colour math ──────────────────────────────────────────────
const srgbToLin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const luminance = ({ r, g, b }) => 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b)
function contrast(a, b) {
  const l1 = luminance(a), l2 = luminance(b)
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

// #rgb / #rrggbb → { r, g, b }
function hex(h) {
  let s = h.replace('#', '')
  if (s.length === 3) s = s.split('').map((c) => c + c).join('')
  return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) }
}
// composite a translucent foreground (alpha `a`) over an opaque background
const over = (fg, a, bg) => ({ r: a * fg.r + (1 - a) * bg.r, g: a * fg.g + (1 - a) * bg.g, b: a * fg.b + (1 - a) * bg.b })
// color-mix(in srgb, A, B) with A weighted `af` (B weighted 1-af); srgb space
const mix = (a, b, af) => ({ r: af * a.r + (1 - af) * b.r, g: af * a.g + (1 - af) * b.g, b: af * a.b + (1 - af) * b.b })
const BLACK = { r: 0, g: 0, b: 0 }
const WHITE = hex('#ffffff')

// ── accents (single source of truth: src/lib/accents.ts) ─────
const accentsSrc = readFileSync(join(root, 'src/lib/accents.ts'), 'utf8')
const ACCENTS = [...accentsSrc.matchAll(
  /slug:\s*'([^']+)'[^}]*?light:\s*'(#[0-9a-fA-F]{6})'[^}]*?dark:\s*'(#[0-9a-fA-F]{6})'/g,
)].map((m) => ({ slug: m[1], light: m[2], dark: m[3] }))
if (ACCENTS.length !== 10) {
  console.error(`check-contrast: expected 10 accents in src/lib/accents.ts, parsed ${ACCENTS.length}`)
  process.exit(1)
}

// ── resolved base semantic tokens (globals.css §2 light / §3 dark) ─
const CANVAS = { light: WHITE, dark: hex('#1a1d21') }
const SIDEBAR_BG = { light: hex('#0c3b37'), dark: hex('#121417') }
const BASE = {
  light: {
    textDefault: hex('#1d1c1d'),                       // --text-default (neutral-900)
    textMuted: hex('#616160'),                         // --text-muted   (neutral-600)
    textSubtle: hex('#71706e'),                        // --text-subtle  (nudged for AA)
    textDanger: hex('#e01e5a'),                        // --text-danger  (= --color-danger)
    sidebarMuted: over(WHITE, 0.55, SIDEBAR_BG.light), // --sidebar-muted rgb(255 255 255/.55)
    accent: hex('#0d9488'),                            // --accent (teal-600)
    accentOn: WHITE,                                   // --accent-on (neutral-0)
    ring: hex('#0d9488'),                              // --ring-focus (teal-600, nudged)
    selected: hex('#eaf6f4'),                          // --bg-selected
    sidebarActive: hex('#0f766e'),                     // --sidebar-active-bg (teal-700)
  },
  dark: {
    textDefault: hex('#d1d2d3'),
    textMuted: hex('#ababad'),
    textSubtle: hex('#8d8f92'),                        // --text-subtle (dark)
    textDanger: hex('#ff6b81'),                        // --text-danger (dark, lightened)
    sidebarMuted: over(WHITE, 0.50, SIDEBAR_BG.dark),  // rgb(255 255 255/.50)
    accent: hex('#14b8a6'),                            // --accent (teal-500)
    accentOn: hex('#06231f'),                          // --accent-on
    ring: hex('#2dd4bf'),                              // --ring-focus (teal-400)
    selected: hex('#0f2c2a'),                          // --bg-selected
    sidebarActive: hex('#0f766e'),                     // --sidebar-active-bg (teal-700)
  },
}

// ── run the checks ───────────────────────────────────────────
const AA_TEXT = 4.5   // WCAG AA, normal text
const UI = 3.0        // WCAG non-text / UI-component bar
const failures = []
let count = 0
function check(theme, name, fg, bg, min) {
  count++
  const c = contrast(fg, bg)
  if (c < min) failures.push(`[${theme}] ${name} — ${c.toFixed(2)}:1 (needs ${min}:1)`)
}

for (const theme of ['light', 'dark']) {
  const b = BASE[theme], canvas = CANVAS[theme]
  check(theme, 'text-default / canvas', b.textDefault, canvas, AA_TEXT)
  check(theme, 'text-muted / canvas', b.textMuted, canvas, AA_TEXT)
  check(theme, 'text-subtle / canvas', b.textSubtle, canvas, AA_TEXT)
  check(theme, 'text-danger / canvas', b.textDanger, canvas, AA_TEXT)
  check(theme, 'sidebar-muted / sidebar-bg', b.sidebarMuted, SIDEBAR_BG[theme], AA_TEXT)
  check(theme, 'text-default / bg-selected', b.textDefault, b.selected, AA_TEXT) // selected rows stay readable
  check(theme, 'sidebar-active-text / sidebar-active-bg', WHITE, b.sidebarActive, AA_TEXT) // active nav label
  check(theme, 'accent-on / accent', b.accentOn, b.accent, UI)
  check(theme, 'ring-focus / canvas', b.ring, canvas, UI)
}

// Accent presets — re-derive the two adjudicated non-text pairs exactly as
// globals.css does: light accent-on is #fff and the ring is the raw preset hex;
// dark accent-on is color-mix(in srgb, <preset>, #000 78%) = 22% of the preset.
for (const a of ACCENTS) {
  check('light', `accent[${a.slug}] on / accent`, WHITE, hex(a.light), UI)
  check('light', `accent[${a.slug}] ring / canvas`, hex(a.light), CANVAS.light, UI)
  check('dark', `accent[${a.slug}] on / accent`, mix(hex(a.dark), BLACK, 0.22), hex(a.dark), UI)
  check('dark', `accent[${a.slug}] ring / canvas`, hex(a.dark), CANVAS.dark, UI)
}

if (failures.length) {
  console.error(`check-contrast: FAILED — ${failures.length} of ${count} pair(s) below bar:`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`check-contrast: PASSED — ${count} pairs (base + ${ACCENTS.length} accents × 2 themes) clear their bars.`)
