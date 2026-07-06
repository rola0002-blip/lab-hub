import 'server-only'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const ALLOWED: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }
const MAX_BYTES = 2 * 1024 * 1024

export function uploadsDir() {
  return path.resolve(process.env.UPLOADS_DIR ?? './data/uploads')
}

export function validateUpload(mime: string, size: number): string {
  const ext = ALLOWED[mime]
  if (!ext || size > MAX_BYTES || size === 0) throw new Error('invalid_upload')
  return ext
}

export async function saveUpload(file: File, kind: 'logo' | 'equipment'): Promise<string> {
  const ext = validateUpload(file.type, file.size)
  const name = `${randomUUID()}${ext}`
  const dir = path.join(uploadsDir(), kind)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()))
  return `/uploads/${kind}/${name}`
}

export async function readUpload(relPath: string[]): Promise<{ data: Buffer; mime: string } | null> {
  const safe = relPath.map((p) => p.replace(/[^a-zA-Z0-9._-]/g, ''))
  const full = path.join(uploadsDir(), ...safe)
  if (!full.startsWith(uploadsDir())) return null
  const ext = path.extname(full)
  const mime = Object.entries(ALLOWED).find(([, e]) => e === ext)?.[0] ?? (ext === '.jpg' ? 'image/jpeg' : null)
  if (!mime) return null
  try { return { data: await readFile(full), mime } } catch { return null }
}
