'use client'
import { useState, useTransition } from 'react'
import { Modal } from '@/components/ui/modal'
import type { TrainingRow, RevocationRow } from '@/features/certifications/service'
import { revokeTrainingRecordAction } from './actions'

export type LedgerRow = (TrainingRow & { kind: 'training' }) | (RevocationRow & { kind: 'revocation' })

const BADGE = 'ml-1.5 inline-flex items-center rounded-full border border-border px-1.5 py-0.5 text-2xs text-muted'

export default function History({ rows, editable }: { rows: LedgerRow[]; editable: string[] }) {
  const [target, setTarget] = useState<TrainingRow | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-default">Training history</h2>
      <div className="mt-2 overflow-x-auto rounded-xl border border-border bg-surface">
        {/* min-w-[38rem] (the /ra pan idiom): SIX columns since W14-A (five data
            columns + actions), so the wrapper pans at 375px instead of crushing the
            Note column — md+ the table still grows to full width. */}
        <table className="min-w-[38rem] w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-subtle">
              <th className="p-2">Date</th><th className="p-2">Person</th><th className="p-2">Instrument</th>
              <th className="p-2">Trainer</th><th className="p-2">Note</th><th className="p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => r.kind === 'training' ? (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="whitespace-nowrap p-2 text-default">{r.trainedOn}
                  {r.revokedAt && <span className={BADGE}>Revoked</span>}
                </td>
                <td className="p-2 text-default">{r.userName}</td>
                <td className="p-2 text-default">{r.equipmentName}</td>
                <td className="p-2 text-default">{r.trainerName}</td>
                <td className="p-2 text-muted">{r.note}
                  {r.revokedAt && <span className="block text-xs">Revoked {r.revokedOn} by {r.revokedByName}{r.revokeReason ? ` — Reason: ${r.revokeReason}` : ''}</span>}
                </td>
                <td className="p-2 text-right">
                  {!r.revokedAt && editable.includes(r.equipmentId) && (
                    <button type="button" onClick={() => { setError(null); setReason(''); setTarget(r) }}
                      className="rounded-md border border-border px-2 py-1 text-xs text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">Revoke</button>
                  )}
                </td>
              </tr>
            ) : (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="whitespace-nowrap p-2 text-default">{r.revokedOn}
                  <span className={BADGE}>Cert revoked</span>
                </td>
                <td className="p-2 text-default">{r.userName}</td>
                <td className="p-2 text-default">{r.equipmentName}</td>
                <td className="p-2 text-default">{r.revokedByName}</td>
                <td className="p-2 text-muted">Certification revoked — {r.reason}</td>
                <td className="p-2" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {target && (
        <Modal title={`Revoke training record — ${target.userName} on ${target.equipmentName}`} onClose={() => setTarget(null)}>
          <p className="mt-2 text-sm text-muted">The record is annulled and, if still held, the certification is revoked with the same reason.</p>
          <label className="mt-3 block text-sm text-default">Reason <span className="text-subtle">(required)</span>
            <textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
          </label>
          {error && <p role="alert" className="mt-2 text-sm text-[var(--text-danger)]">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setTarget(null)}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">Cancel</button>
            <button type="button" disabled={pending || !reason.trim()}
              onClick={() => start(async () => {
                const r = await revokeTrainingRecordAction(target.id, reason)
                if (r.ok) setTarget(null); else setError(r.message ?? 'Failed')
              })}
              className="rounded-md bg-[var(--color-danger)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">Revoke</button>
          </div>
        </Modal>
      )}
    </section>
  )
}
