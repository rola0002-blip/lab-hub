// Fractional-index ordering keys for board cards. Keys are base-62 strings
// compared lexicographically, interpreted as fractions in (0,1). Invariant: a key
// never ends in the lowest digit ('0'), so lexicographic order equals fraction
// order. `Issue.rank` is stored COLLATE "C" so Postgres byte-orders it identically.
// `rankBetween(a,b)` returns the shortest key strictly between its bounds (null
// lower = column start, null upper = column end); `rebalance(n)` reseats a whole
// column with evenly-spaced keys when adjacent keys can no longer be split.

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length // 62
const val = (c: string): number => DIGITS.indexOf(c)

// Keys longer than this mean the column is pathologically dense — the caller
// rebalances instead of appending more precision.
export const REBALANCE_THRESHOLD = 48

export function rankBetween(lower: string | null, upper: string | null): string {
  if (lower !== null && upper !== null && lower >= upper) {
    throw new Error(`rank: bounds not strictly ordered (${lower} >= ${upper})`)
  }
  const a = lower ?? ''
  const b = upper ?? ''
  let out = ''
  let i = 0
  for (let guard = 0; guard < 2000; guard++) {
    const x = i < a.length ? val(a[i]) : 0
    const y = upper === null ? BASE : i < b.length ? val(b[i]) : 0
    if (x === y) { out += DIGITS[x]; i++; continue }
    if (y - x > 1) return out + DIGITS[Math.floor((x + y) / 2)]
    // y === x + 1 (adjacent): take x, then bump the first splittable digit of `a`.
    out += DIGITS[x]; i++
    for (let g2 = 0; g2 < 2000; g2++) {
      const xa = i < a.length ? val(a[i]) : 0
      if (xa < BASE - 1) return out + DIGITS[Math.floor((xa + BASE) / 2)]
      out += DIGITS[xa]; i++
    }
    break
  }
  throw new Error('rank: failed to find a midpoint')
}

// Balanced bisection: fill the middle key first, then recurse into each half with
// tightened bounds, so a rebalanced column is evenly distributed and short.
export function rebalance(n: number): string[] {
  if (n <= 0) return []
  const keys: string[] = new Array(n)
  const fill = (lo: string | null, hi: string | null, start: number, end: number): void => {
    if (start > end) return
    const mid = (start + end) >> 1
    const key = rankBetween(lo, hi)
    keys[mid] = key
    fill(lo, key, start, mid - 1)
    fill(key, hi, mid + 1, end)
  }
  fill(null, null, 0, n - 1)
  return keys
}
