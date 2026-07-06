'use client'
import { useTransition } from 'react'
import { retireEquipmentAction } from './actions'

export default function RetireButton({ id, name, futureCount }: { id: string; name: string; futureCount: number }) {
  const [pending, start] = useTransition()
  return (
    <button disabled={pending} className="text-red-600 hover:underline"
      onClick={() => {
        if (confirm(`Retire ${name}? ${futureCount} future booking(s) will be cancelled and owners notified.`)) start(async () => { await retireEquipmentAction(id) })
      }}>
      Retire
    </button>
  )
}
