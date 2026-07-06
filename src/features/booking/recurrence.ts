import { TZDate } from '@date-fns/tz'

export interface WeeklyRule {
  daysOfWeek: number[]
  startMinutes: number
  durationMinutes: number
  firstDate: string // 'yyyy-MM-dd'
  untilDate: string // inclusive
  timezone: string
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
      const start = new TZDate(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(rule.startMinutes / 60), rule.startMinutes % 60, rule.timezone)
      const startsAt = new Date(+start)
      out.push({ startsAt, endsAt: new Date(+startsAt + rule.durationMinutes * 60_000) })
    }
  }
  return out
}
