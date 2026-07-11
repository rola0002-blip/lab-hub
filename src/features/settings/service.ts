import { prisma } from '@/lib/db'
import { removeUpload } from '@/lib/uploads'

export type Theme = 'light' | 'dark'

// Persist a user's theme choice. Additive, nullable column on the better-auth
// `user` table; the value is applied SSR-side only when the device's
// localStorage is empty (localStorage wins on the device — see ThemeSync).
export async function setThemePreference(userId: string, theme: Theme) {
  await prisma.user.update({ where: { id: userId }, data: { themePreference: theme } })
}

// Persist a user's accent choice (a slug validated by isAccentSlug at the route
// boundary). Additive, nullable column; applied SSR only when the device has no
// localStorage choice (see AccentSync).
export async function setAccentPreference(userId: string, accent: string) {
  await prisma.user.update({ where: { id: userId }, data: { accentPreference: accent } })
}

export async function setName(userId: string, name: string) {
  await prisma.user.update({ where: { id: userId }, data: { name: name.trim() } })
}

export async function setTitle(userId: string, title: string) {
  const t = title.trim()
  await prisma.user.update({ where: { id: userId }, data: { title: t.length ? t : null } })
}

export async function setTimezone(userId: string, timezone: string) {
  // Empty means "Not set" — clear to null, mirroring setTitle.
  const tz = timezone.trim()
  await prisma.user.update({ where: { id: userId }, data: { timezone: tz.length ? tz : null } })
}

export async function setAvatar(userId: string, imagePath: string) {
  const prev = await prisma.user.findUnique({ where: { id: userId }, select: { image: true } })
  await prisma.user.update({ where: { id: userId }, data: { image: imagePath } })
  // Best-effort cleanup of the replaced file so re-uploads don't orphan the old
  // one — only ever our own avatars/ path, mirroring removeAvatar. DB update
  // first so a failed unlink can never lose the new image.
  if (prev?.image && prev.image !== imagePath && prev.image.startsWith('/uploads/avatars/')) {
    await removeUpload(prev.image)
  }
}

export async function removeAvatar(userId: string) {
  const prev = await prisma.user.findUnique({ where: { id: userId }, select: { image: true } })
  await prisma.user.update({ where: { id: userId }, data: { image: null } })
  // Best-effort cleanup of the stored file — only ever our own avatars/ path.
  if (prev?.image?.startsWith('/uploads/avatars/')) await removeUpload(prev.image)
}
