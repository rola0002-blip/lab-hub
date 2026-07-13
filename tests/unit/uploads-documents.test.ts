import { describe, it, expect } from 'vitest'
import { validateUpload } from '@/lib/uploads'

describe("validateUpload('documents', …)", () => {
  it('accepts an office file just under 100 MB and returns the extension', () => {
    expect(validateUpload('application/pdf', 100 * 1024 * 1024, 'documents')).toBe('.pdf')
    expect(validateUpload('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 5_000_000, 'documents')).toBe('.xlsx')
  })
  it('rejects over-cap, zero-byte and disallowed types', () => {
    expect(() => validateUpload('application/pdf', 100 * 1024 * 1024 + 1, 'documents')).toThrow('invalid_upload')
    expect(() => validateUpload('application/pdf', 0, 'documents')).toThrow('invalid_upload')
    expect(() => validateUpload('application/x-msdownload', 10, 'documents')).toThrow('invalid_upload')
  })
  it('keeps the chat/issue 25 MB cap unchanged (a 30 MB pdf is a document but not a chat file)', () => {
    expect(validateUpload('application/pdf', 30 * 1024 * 1024, 'documents')).toBe('.pdf')
    expect(() => validateUpload('application/pdf', 30 * 1024 * 1024, 'chat')).toThrow('invalid_upload')
  })
})
