// Ten preset accents. Each carries a light-mode and a dark-mode tuned hex; the
// active slug is stamped on <html data-accent="…"> alongside data-theme, and
// globals.css maps it onto the accent-role semantic tokens. Teal is the default
// and needs no CSS block — an absent/unknown data-accent falls back to the teal
// :root defaults (zero regression). The sidebar rail is never accent-themed.
export type AccentSlug =
  | 'teal' | 'blue' | 'indigo' | 'purple' | 'magenta'
  | 'crimson' | 'orange' | 'amber' | 'green' | 'graphite'

export type Accent = { slug: AccentSlug; name: string; light: string; dark: string }

export const ACCENTS: readonly Accent[] = [
  { slug: 'teal',     name: 'Teal',         light: '#0d9488', dark: '#14b8a6' },
  { slug: 'blue',     name: 'Ocean Blue',   light: '#2563eb', dark: '#60a5fa' },
  { slug: 'indigo',   name: 'Indigo',       light: '#4f46e5', dark: '#818cf8' },
  { slug: 'purple',   name: 'Purple',       light: '#7c3aed', dark: '#a78bfa' },
  { slug: 'magenta',  name: 'Magenta',      light: '#db2777', dark: '#f472b6' },
  { slug: 'crimson',  name: 'Crimson',      light: '#dc2626', dark: '#f87171' },
  { slug: 'orange',   name: 'Burnt Orange', light: '#c2410c', dark: '#fb923c' },
  { slug: 'amber',    name: 'Amber',        light: '#b45309', dark: '#fbbf24' },
  { slug: 'green',    name: 'Forest Green', light: '#15803d', dark: '#4ade80' },
  { slug: 'graphite', name: 'Graphite',     light: '#475569', dark: '#94a3b8' },
] as const

export const DEFAULT_ACCENT: AccentSlug = 'teal'

const SLUGS = new Set<string>(ACCENTS.map((a) => a.slug))

export function isAccentSlug(v: unknown): v is AccentSlug {
  return typeof v === 'string' && SLUGS.has(v)
}
