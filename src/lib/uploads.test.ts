import { describe, it, expect } from 'vitest'
import { validateUpload } from './uploads'

describe('validateUpload', () => {
  it('accepts small png', () => {
    expect(() => validateUpload('image/png', 1024)).not.toThrow()
  })
  it('rejects wrong mime and oversize', () => {
    expect(() => validateUpload('image/svg+xml', 1024)).toThrow('invalid_upload')
    expect(() => validateUpload('image/png', 3 * 1024 * 1024)).toThrow('invalid_upload')
  })
})
