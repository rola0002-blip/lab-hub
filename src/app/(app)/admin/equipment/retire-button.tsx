'use client'
import { useState, useTransition } from 'react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { retireEquipmentAction } from './actions'

export default function RetireButton({ id, name, futureCount }: { id: string; name: string; futureCount: number }) {
  const [pending, start] = useTransition()
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      <button disabled={pending} className="text-[var(--text-danger)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] rounded"
        onClick={() => setConfirming(true)}>
        Retire
      </button>
      <ConfirmDialog open={confirming} danger title={`Retire ${name}?`}
        body={`${futureCount} future booking(s) will be cancelled and owners notified.`}
        confirmLabel="Retire"
        onClose={() => setConfirming(false)}
        onConfirm={() => start(async () => { await retireEquipmentAction(id) })} />
    </>
  )
}
