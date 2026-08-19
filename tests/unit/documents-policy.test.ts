import { describe, it, expect } from 'vitest'
import { canUpload, assertCanUpload, canDeleteDocument, assertCanDeleteDocument, canModifyDocument, assertCanModifyDocument, canManageFolder, assertCanManageFolder, PolicyError } from '@/features/documents/documents-policy'

describe('documents-policy', () => {
  it('upload/create-folder: admin+member yes, guest no', () => {
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
  it('rename/move file: uploader or admin only (W4-C)', () => {
    expect(canModifyDocument('member', 'u1', 'u1')).toBe(true)   // member × own upload
    expect(canModifyDocument('member', 'u1', 'u2')).toBe(false)  // member × another's (e.g. admin's) file
    expect(canModifyDocument('admin', 'u1', 'u2')).toBe(true)    // admin × any file
    expect(canModifyDocument('guest', 'u1', 'u2')).toBe(false)   // guest × any real file — guests never upload, so no file is ever theirs
    expect(canModifyDocument('guest', 'u1', 'u1')).toBe(true)    // canDeleteDocument quirk: author-or-admin predicate, unreachable for guests (they can't upload)
    expect(() => assertCanModifyDocument('member', 'u1', 'u2')).toThrow(PolicyError)
    expect(() => assertCanModifyDocument('member', 'u1', 'u1')).not.toThrow()
    expect(() => assertCanModifyDocument('admin', 'u1', 'u2')).not.toThrow()
  })
  it('folder rename/delete: creator or admin only', () => {
    expect(canManageFolder('member', 'c1', 'c1')).toBe(true)
    expect(canManageFolder('admin', 'c1', 'c2')).toBe(true)
    expect(canManageFolder('member', 'c1', 'c2')).toBe(false)
    expect(() => assertCanManageFolder('member', 'c1', 'c2')).toThrow(PolicyError)
  })
})
