'use client'
import { useRouter } from 'next/navigation'
import { Avatar } from '@/components/ui/avatar'
import { Menu } from '@/components/ui/menu'
import { authClient } from '@/lib/auth-client'

export function UserMenu({ user }: { user: { id: string; name: string; image: string | null } }) {
  const router = useRouter()
  async function signOut() {
    await authClient.signOut()
    router.push('/sign-in')
  }
  return (
    <Menu
      label="Your account"
      buttonClassName="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover"
      button={<Avatar name={user.name} id={user.id} image={user.image} size={24} />}
      items={[
        { label: 'Profile', onSelect: () => router.push('/profile') },
        { label: 'Sign out', onSelect: signOut, danger: true },
      ]}
    />
  )
}
