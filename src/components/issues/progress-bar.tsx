export function ProgressBar({ done, total, percent }: { done: number; total: number; percent: number }) {
  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-active" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${percent}% complete`}>
        <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-2xs text-subtle">{done}/{total} done · {percent}%</p>
    </div>
  )
}
