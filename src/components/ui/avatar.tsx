import { initials, avatarHue } from '@/lib/avatar'

const SIZES = { 48: 'h-12 w-12 text-base', 36: 'h-9 w-9 text-sm', 24: 'h-6 w-6 text-2xs', 20: 'h-5 w-5 text-2xs' } as const

export function Avatar({ name, id, image, size = 36, presence = null }: {
  name: string; id: string; image?: string | null
  size?: 48 | 36 | 24 | 20; presence?: 'active' | 'away' | null
}) {
  const body = image ? (
    // eslint-disable-next-line @next/next/no-img-element -- uploads are served by our own route
    <img src={image} alt="" className="h-full w-full rounded-[var(--radius-avatar)] object-cover" />
  ) : (
    <span
      aria-hidden
      className="flex h-full w-full items-center justify-center rounded-[var(--radius-avatar)] font-semibold text-white"
      style={{ background: `hsl(${avatarHue(id)} 45% 42%)` }}
    >{initials(name)}</span>
  )
  return (
    <span className={`relative inline-block shrink-0 ${SIZES[size]}`}>
      {body}
      {presence && (
        <span
          aria-hidden
          className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-[var(--bg-canvas)] ${
            presence === 'active' ? 'bg-[var(--color-presence-active)]' : 'bg-transparent ring-1 ring-inset ring-[var(--color-presence-away)]'
          }`}
        />
      )}
    </span>
  )
}
