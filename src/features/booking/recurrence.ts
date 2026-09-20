import { TZDate } from '@date-fns/tz'
import { wallTimeExists } from '@/lib/wall-time'

export interface WeeklyRule {
  daysOfWeek: number[]
  startMinutes: number
  durationMinutes: number
  firstDate: string // 'yyyy-MM-dd'
  untilDate: string // inclusive
  timezone: string
}

// Thrown when an occurrence's wall start time is skipped by a DST transition
// (e.g. 02:30 on a US spring-forward Sunday). createRecurringBooking maps this
// to a blocked verdict; the booking dialog (Task 2) surfaces it client-side.
export class NonexistentWallTimeError extends Error {
  constructor(public readonly date: string) {
    super(`Time does not exist on ${date} (daylight-saving transition).`)
    this.name = 'NonexistentWallTimeError'
  }
}

export function expandWeekly(rule: WeeklyRule): Array<{ startsAt: Date; endsAt: Date }> {
  const out: Array<{ startsAt: Date; endsAt: Date }> = []
  const [fy, fm, fd] = rule.firstDate.split('-').map(Number)
  const [uy, um, ud] = rule.untilDate.split('-').map(Number)
  const days = new Set(rule.daysOfWeek)
  // Iterate calendar days in the org timezone; TZDate resolves each local time to a UTC instant.
  for (let d = new TZDate(fy, fm - 1, fd, rule.timezone); ; d = new TZDate(d.getFullYear(), d.getMonth(), d.getDate() + 1, rule.timezone)) {
    const past = d.getFullYear() > uy || (d.getFullYear() === uy && (d.getMonth() + 1 > um || (d.getMonth() + 1 === um && d.getDate() > ud)))
    if (past) break
    if (days.has(d.getDay())) {
      const hh = Math.floor(rule.startMinutes / 60)
      const mm = rule.startMinutes % 60
      if (!wallTimeExists(d.getFullYear(), d.getMonth() + 1, d.getDate(), hh, mm, rule.timezone)) {
        const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        throw new NonexistentWallTimeError(day)
      }
      const start = new TZDate(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, rule.timezone)
      const startsAt = new Date(+start)
      out.push({ startsAt, endsAt: new Date(+startsAt + rule.durationMinutes * 60_000) })
    }
  }
  return out
}
