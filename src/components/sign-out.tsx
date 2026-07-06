'use client'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

export default function SignOutButton() {
  const router = useRouter()
  return (
    <button className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
      onClick={async () => { await authClient.signOut(); router.push('/sign-in') }}>
      Sign out
    </button>
  )
}
