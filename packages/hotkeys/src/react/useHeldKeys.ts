import { useKeyState } from './_use-key-state.js'

/**
 * React hook that returns an array of currently held keyboard keys.
 *
 * Subscribes to the global KeyStateTracker after commit and updates whenever
 * keys are pressed or released. Returns an empty array during server rendering.
 *
 * @returns Array of currently held key names
 *
 * @example
 * ```tsx
 * function KeyDisplay() {
 *   const heldKeys = useHeldKeys()
 *
 *   return (
 *     <div>
 *       Currently pressed: {heldKeys.join(' + ') || 'None'}
 *     </div>
 *   )
 * }
 * ```
 */
export function useHeldKeys(): Array<string> {
  return useKeyState((state) => state.heldKeys)
}
