'use client'
import { useState, useCallback } from 'react'
import { nextRovingIndex } from '@/lib/roving'

export function useRovingFocus(count: number) {
  const [activeIndex, setActiveIndex] = useState(0)
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const k = e.key
    if (k !== 'ArrowUp' && k !== 'ArrowDown' && k !== 'Home' && k !== 'End' && k !== 'PageUp' && k !== 'PageDown') return
    e.preventDefault()
    setActiveIndex((i) => nextRovingIndex(i, count, k as Parameters<typeof nextRovingIndex>[2]))
  }, [count])
  return { activeIndex, setActiveIndex, onKeyDown }
}
