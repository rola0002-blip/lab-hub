import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { validateUpload, uploadsDir, saveUpload, readUpload } from './uploads'

describe('validateUpload', () => {
  it('accepts small png', () => {
    expect(() => validateUpload('image/png', 1024)).not.toThrow()
  })
  it('rejects wrong mime, oversize, and empty', () => {
    expect(() => validateUpload('image/svg+xml', 1024)).toThrow('invalid_upload')
    expect(() => validateUpload('image/png', 3 * 1024 * 1024)).toThrow('invalid_upload')
    expect(() => validateUpload('image/png', 0)).toThrow('invalid_upload')
  })
})

describe('uploadsDir', () => {
  it('resolves UPLOADS_DIR to an absolute path', () => {
    const prev = process.env.UPLOADS_DIR
    process.env.UPLOADS_DIR = './data/uploads'
    expect(path.isAbsolute(uploadsDir())).toBe(true)
    process.env.UPLOADS_DIR = prev
  })
})

describe('saveUpload + readUpload', () => {
  let dir: string
  const prev = process.env.UPLOADS_DIR

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'labhub-uploads-'))
    process.env.UPLOADS_DIR = dir
  })
  afterAll(async () => {
    process.env.UPLOADS_DIR = prev
    await rm(dir, { recursive: true, force: true })
  })

  it('saves a validated file then reads it back with its mime', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' })
    const url = await saveUpload(file, 'logo')
    expect(url).toMatch(/^\/uploads\/logo\/[0-9a-f-]+\.png$/)
    const rel = url.replace('/uploads/', '').split('/')
    const read = await readUpload(rel)
    expect(read?.mime).toBe('image/png')
    expect(read?.data).toEqual(Buffer.from([1, 2, 3]))
  })

  it('resolves the .jpg fallback mime for an in-dir path', async () => {
    await mkdir(path.join(dir, 'equipment'), { recursive: true })
    await writeFile(path.join(dir, 'equipment', 'photo.jpg'), Buffer.from('x'))
    // .jpg has no direct ALLOWED entry, so readUpload falls back to image/jpeg
    const read = await readUpload(['equipment', 'photo.jpg'])
    expect(read?.mime).toBe('image/jpeg')
  })

  it('blocks path traversal via a ".." segment', async () => {
    // dots survive the sanitiser, so `..` resolves outside uploadsDir(); the
    // startsWith guard then rejects it with null (never reads the file).
    expect(await readUpload(['..', 'equipment', 'photo.jpg'])).toBeNull()
  })

  it('returns null for an unknown extension and for a missing file', async () => {
    expect(await readUpload(['equipment', 'note.txt'])).toBeNull()
    expect(await readUpload(['logo', 'does-not-exist.png'])).toBeNull()
  })
})
