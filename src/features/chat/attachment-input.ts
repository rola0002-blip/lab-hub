// src/features/chat/attachment-input.ts
// Pure, client-safe gate shared by the picker, the drop handler and the paste
// handler so the three entrances can never diverge (F1). CHAT_MIMES mirrors
// CHAT_ALLOWED in src/lib/uploads.ts — the drift test fails the build if they drift.
export const CHAT_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv', 'application/zip',
])
export const CHAT_MAX_SIZE = 25 * 1024 * 1024
export const CHAT_MAX_FILES = 10

export function validateAttachmentFiles(files: File[], existingCount: number): { accepted: File[]; errors: string[] } {
  const accepted: File[] = []; const errors: string[] = []
  for (const f of files) {
    if (!CHAT_MIMES.has(f.type)) { errors.push(`${f.name}: file type not allowed.`); continue }
    if (f.size > CHAT_MAX_SIZE || f.size === 0) { errors.push(`${f.name}: files must be under 25 MB.`); continue }
    if (existingCount + accepted.length >= CHAT_MAX_FILES) { errors.push(`Attachment limit is ${CHAT_MAX_FILES} files per message.`); continue }
    accepted.push(f)
  }
  return { accepted, errors }
}
