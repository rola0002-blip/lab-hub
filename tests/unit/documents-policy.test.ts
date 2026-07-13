import { describe, it, expect } from 'vitest'
import { canUpload, assertCanUpload, canDeleteDocument, assertCanDeleteDocument, canManageFolder, assertCanManageFolder, PolicyError } from '@/features/documents/documents-policy'

describe('documents-policy', () => {
  it('upload/rename/move/create-folder: admin+member yes, guest no', () => {
    expect(canUpload('admin')).toBe(true)
    expect(canUpload('member')).toBe(true)
    expect(canUpload('guest')).toBe(false)
    expect(() => assertCanUpload('guest')).toThrow(PolicyError)
    expect(() => assertCanUpload('member')).not.toThrow()
  })
  it('delete file: uploader or admin only', () => {
    expect(canDeleteDocument('member', 'u1', 'u1')).toBe(true)   // uploader
    expect(canDeleteDocument('admin', 'u1', 'u2')).toBe(true)    // admin
    expect(canDeleteDocument('member', 'u1', 'u2')).toBe(false)  // other member
    expect(canDeleteDocument('guest', 'u1', 'u1')).toBe(true)    // a guest CANNOT upload, but the predicate is author-or-admin; guests never reach it (they can't upload)
    expect(() => assertCanDeleteDocument('member', 'u1', 'u2')).toThrow(PolicyError)
  })
  it('folder rename/delete: creator or admin only', () => {
    expect(canManageFolder('member', 'c1', 'c1')).toBe(true)
    expect(canManageFolder('admin', 'c1', 'c2')).toBe(true)
    expect(canManageFolder('member', 'c1', 'c2')).toBe(false)
    expect(() => assertCanManageFolder('member', 'c1', 'c2')).toThrow(PolicyError)
  })
})
