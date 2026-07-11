import { prisma } from '@/lib/db'

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
