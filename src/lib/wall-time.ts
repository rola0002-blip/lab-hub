import { TZDate } from '@date-fns/tz'

/** Minutes-of-day of `d`'s wall clock in `tz`, plus the yyyy-MM-dd wall date. */
export function wallMinutes(d: Date, tz: string): { min: number; day: string } {
  const z = new TZDate(d.getTime(), tz)
  const day = `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`
  return { min: z.getHours() * 60 + z.getMinutes(), day }
}

/** True when both instants fall on the same calendar day in `tz`. */
export function sameOrgDay(a: Date, b: Date, tz: string): boolean {
  return wallMinutes(a, tz).day === wallMinutes(b, tz).day
}

/** A requested wall time exists (no DST skip) if formatting the constructed
 *  instant back in `tz` yields the same clock time. */
export function wallTimeExists(y: number, m: number, d: number, hh: number, mm: number, tz: string): boolean {
  const inst = new Date(new TZDate(y, m - 1, d, hh, mm, tz).getTime())
  const back = new TZDate(inst.getTime(), tz)
  return back.getHours() === hh && back.getMinutes() === mm
}
