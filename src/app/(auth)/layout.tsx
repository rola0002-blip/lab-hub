import { ThemeToggle } from '@/components/theme-toggle'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-surface-sunken p-6">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      {children}
    </main>
  )
}
