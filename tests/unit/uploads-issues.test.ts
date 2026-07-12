import { describe, it, expect } from 'vitest'
import { validateUpload } from '@/lib/uploads'

describe('validateUpload issues kind', () => {
  it('accepts a 20 MB PDF and rejects a 30 MB one under the chat allowlist', () => {
    expect(validateUpload('application/pdf', 20 * 1024 * 1024, 'issues')).toBe('.pdf')
    expect(() => validateUpload('application/pdf', 30 * 1024 * 1024, 'issues')).toThrow('invalid_upload')
    expect(() => validateUpload('application/x-msdownload', 1024, 'issues')).toThrow('invalid_upload')
  })
})
