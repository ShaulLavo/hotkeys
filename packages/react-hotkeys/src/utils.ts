import { useEffect, useLayoutEffect } from 'react'
import type React from 'react'

// Preserve commit-time ref updates in the browser without React 18's SSR layout-effect warning.
export const useIsomorphicLayoutEffect =
  typeof document === 'undefined' ? useEffect : useLayoutEffect

/**
 * Type guard to check if a value is a React ref-like object.
 */
export function isRef(value: unknown): value is React.RefObject<HTMLElement | null> {
  return value !== null && typeof value === 'object' && 'current' in value
}
