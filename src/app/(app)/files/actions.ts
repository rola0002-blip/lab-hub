'use server'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/session'
import { PolicyError } from '@/features/documents/documents-policy'
import * as docs from '@/features/documents/document-service'

type Result = { ok: true } | { ok: false; message: string }

function fail(e: unknown): Result {
  if (e instanceof PolicyError) return { ok: false, message: e.message }
  return { ok: false, message: e instanceof Error ? e.message : 'Something went wrong.' }
}

export async function createFolderAction(name: string): Promise<Result> {
  const u = await requireUser()
  try { await docs.createFolder({ userId: u.id, role: u.role, name }); revalidatePath('/files'); return { ok: true } } catch (e) { return fail(e) }
}
export async function renameFolderAction(id: string, name: string): Promise<Result> {
  const u = await requireUser()
  try { await docs.renameFolder({ userId: u.id, role: u.role, id, name }); revalidatePath('/files'); return { ok: true } } catch (e) { return fail(e) }
}
export async function deleteFolderAction(id: string): Promise<Result> {
  const u = await requireUser()
  try { await docs.deleteFolder({ userId: u.id, role: u.role, id }); revalidatePath('/files'); return { ok: true } } catch (e) { return fail(e) }
}
export async function renameDocumentAction(id: string, name: string): Promise<Result> {
  const u = await requireUser()
  try { await docs.renameDocument({ userId: u.id, role: u.role, id, name }); revalidatePath('/files'); return { ok: true } } catch (e) { return fail(e) }
}
export async function moveDocumentAction(id: string, folderId: string | null): Promise<Result> {
  const u = await requireUser()
  try { await docs.moveDocument({ userId: u.id, role: u.role, id, folderId }); revalidatePath('/files'); return { ok: true } } catch (e) { return fail(e) }
}
export async function deleteDocumentAction(id: string): Promise<Result> {
  const u = await requireUser()
  try { await docs.deleteDocument({ userId: u.id, role: u.role, id }); revalidatePath('/files'); return { ok: true } } catch (e) { return fail(e) }
}
