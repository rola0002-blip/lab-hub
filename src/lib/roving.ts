export function nextRovingIndex(
  current: number, count: number,
  key: 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'PageUp' | 'PageDown',
  pageSize = 5,
): number {
  if (count <= 0) return -1
  const last = count - 1
  switch (key) {
    case 'ArrowDown': return Math.min(current + 1, last)
    case 'ArrowUp': return Math.max(current - 1, 0)
    case 'Home': return 0
    case 'End': return last
    case 'PageDown': return Math.min(current + pageSize, last)
    case 'PageUp': return Math.max(current - pageSize, 0)
  }
}
