import { describe, it, expect } from 'vitest'
import { csvCell } from '@/features/ra/csv'

describe('csvCell formula guard', () => {
  it('neutralizes formula prefixes', () => {
    expect(csvCell('=SUM(A1)')).toBe('"\'=SUM(A1)"')
    expect(csvCell('+1')).toBe("\"'+1\"")
    expect(csvCell('-1')).toBe("\"'-1\"")
    expect(csvCell('@x')).toBe("\"'@x\"")
  })
  it('leaves normal values and escapes quotes', () => {
    expect(csvCell('Roland')).toBe('"Roland"')
    expect(csvCell('a"b')).toBe('"a""b"')
  })
})
