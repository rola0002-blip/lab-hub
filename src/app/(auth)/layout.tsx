import { ThemeToggle } from '@/components/theme-toggle'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    // 100dvh, not 100vh: on mobile Safari/Chrome `vh` is the LARGEST viewport, so
    // min-h-screen leaves the sign-in card scrolled under the browser chrome.
    <main className="relative flex min-h-[100dvh] items-center justify-center bg-surface-sunken p-6">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      {children}
    </main>
  )
}
