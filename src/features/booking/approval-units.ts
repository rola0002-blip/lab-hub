// W20-D: the Approvals queue's unit — pure + CLIENT-SAFE. /approvals renders ONE
// card per single request and ONE per recurring series (occurrences grouped by
// recurrenceRuleId), so the nav badge and the dashboard banner count cards, never
// raw PENDING rows: a 10-occurrence series is one decision, not ten.
export function approvalUnits(rows: { recurrenceRuleId: string | null }[]): number {
  const series = new Set<string>()
  let singles = 0
  for (const r of rows) {
    if (r.recurrenceRuleId) series.add(r.recurrenceRuleId)
    else singles++
  }
  return singles + series.size
}
