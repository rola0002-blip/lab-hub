// Pure, client-safe predicates for project-scoped labels (F5).
import { LABEL_PALETTE } from './status'

export type LabelRow = { id: string; name: string; color: string; projectId: string | null }

// Cycle the fixed palette by scope count (spec §3.3).
export function nextLabelColor(countInScope: number): string {
  return LABEL_PALETTE[countInScope % LABEL_PALETTE.length]
}

// Which of an issue's labels may SURVIVE on the given project: workspace-global
// labels always; project labels only on their own project. Used by createIssue
// (silent drop) and setProject (detach + activity) so the two paths share one
// definition of "belongs".
export function splitLabelsForProject<T extends LabelRow>(labels: T[], projectId: string | null): { keep: T[]; drop: T[] } {
  const keep: T[] = []; const drop: T[] = []
  for (const l of labels) (l.projectId === null || l.projectId === projectId ? keep : drop).push(l)
  return { keep, drop }
}
