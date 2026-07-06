'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export type NavItem = { href: string; label: string }

export default function Sidebar({ items }: { items: NavItem[] }) {
  const path = usePathname()
  return (
    <nav className="flex flex-col gap-1 p-3">
      {items.map((i) => {
        const active = path === i.href || path.startsWith(i.href + '/')
        return (
          <Link key={i.href} href={i.href}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${active ? 'bg-accent/10 text-accent' : 'text-gray-700 hover:bg-gray-100'}`}>
            {i.label}
          </Link>
        )
      })}
    </nav>
  )
}
