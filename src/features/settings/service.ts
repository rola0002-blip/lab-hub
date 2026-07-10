import { prisma } from '@/lib/db'

export type Theme = 'light' | 'dark'

// Persist a user's theme choice. Additive, nullable column on the better-auth
// `user` table; the value is applied SSR-side only when the device's
// localStorage is empty (localStorage wins on the device — see ThemeSync).
export async function setThemePreference(userId: string, theme: Theme) {
  await prisma.user.update({ where: { id: userId }, data: { themePreference: theme } })
}
