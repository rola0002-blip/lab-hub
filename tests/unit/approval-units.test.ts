import { describe, it, expect } from 'vitest'
import { approvalUnits } from '@/features/booking/approval-units'

describe('approvalUnits', () => {
  it('counts singles one each and every recurring series once', () => {
    expect(approvalUnits([])).toBe(0)
    expect(approvalUnits([{ recurrenceRuleId: null }, { recurrenceRuleId: null }])).toBe(2)
    expect(approvalUnits([{ recurrenceRuleId: 'r1' }, { recurrenceRuleId: 'r1' }, { recurrenceRuleId: 'r1' }])).toBe(1)
    expect(approvalUnits([{ recurrenceRuleId: 'r1' }, { recurrenceRuleId: null }, { recurrenceRuleId: 'r2' }, { recurrenceRuleId: 'r1' }])).toBe(3)
  })
})
