// Wave 19: persisted min-width for the Files listing's Name column. Pure +
// client-safe (the sort.ts posture) so it sits inside the coverage gate; the
// useSyncExternalStore wiring stays in files-client (the board-collapse split).
export const NAME_WIDTH_MIN = 240
export const NAME_WIDTH_MAX = 720

// Unset, non-numeric, fractional, or out-of-range all read as "unset" — the
// parse-with-fallback posture of board-collapse.ts.
export function parseNameWidth(raw: string | null): number | null {
  if (raw === null) return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n < NAME_WIDTH_MIN || n > NAME_WIDTH_MAX) return null
  return n
}

export function clampNameWidth(px: number): number {
  // NaN (a corrupt gesture reading) floors; ±Infinity clamps to the near bound.
  if (Number.isNaN(px)) return NAME_WIDTH_MIN
  return Math.min(NAME_WIDTH_MAX, Math.max(NAME_WIDTH_MIN, Math.round(px)))
}

// Keyboard nudge: ArrowLeft/Right ±24. Nudging below the floor RESETS the
// column (null) — the double-click reset's keyboard equivalent.
export function nudgeNameWidth(current: number | null, delta: number): number | null {
  const next = (current ?? NAME_WIDTH_MIN) + delta
  if (next < NAME_WIDTH_MIN) return null
  return clampNameWidth(next)
}
