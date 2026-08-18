import { describe, it, expect } from 'vitest'
import { validateAttachmentFiles, CHAT_MIMES, CHAT_MAX_SIZE, CHAT_MAX_FILES } from './attachment-input'
import { CHAT_ALLOWED, CHAT_MAX } from '@/lib/uploads'

const file = (name: string, type: string, size = 1024) => new File([new Uint8Array(size)], name, { type })

describe('validateAttachmentFiles', () => {
  it('accepts allowed types, rejects mime and size with named errors', () => {
    const r = validateAttachmentFiles([file('a.png', 'image/png'), file('x.exe', 'application/octet-stream'), file('big.pdf', 'application/pdf', CHAT_MAX_SIZE + 1)], 0)
    expect(r.accepted.map((f) => f.name)).toEqual(['a.png'])
    expect(r.errors).toHaveLength(2)
  })
  it('rejects empty files', () => {
    const r = validateAttachmentFiles([file('empty.txt', 'text/plain', 0)], 0)
    expect(r.accepted).toHaveLength(0)
    expect(r.errors[0]).toContain("empty files can't be attached")
  })
  it('caps at 10 attachments counting existing chips', () => {
    const r = validateAttachmentFiles(Array.from({ length: 3 }, (_, i) => file(`f${i}.png`, 'image/png')), CHAT_MAX_FILES - 1)
    expect(r.accepted).toHaveLength(1)
    expect(r.errors[0]).toContain('limit')
  })
  it('stays in sync with the server allowlist and size cap', () => {
    expect([...CHAT_MIMES].sort()).toEqual(Object.keys(CHAT_ALLOWED).sort())
    expect(CHAT_MAX_SIZE).toBe(CHAT_MAX)
  })
})
