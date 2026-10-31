import { useKeyState } from './_use-key-state.js'
import type { IndividualKey } from '@fregat/hotkeys'

/**
 * React hook that returns whether a specific key is currently being held.
 *
 * Subscribes to the global KeyStateTracker after commit and selects whether
 * the specified key is held. Returns false during server rendering.
 *
 * @param key - The key to check (e.g., 'Shift', 'Control', 'A')
 * @returns True if the key is currently held down
 *
 * @example
 * ```tsx
 * function ShiftIndicator() {
 *   const isShiftHeld = useKeyHold('Shift')
 *
 *   return (
 *     <div style={{ opacity: isShiftHeld ? 1 : 0.5 }}>
 *       {isShiftHeld ? 'Shift is pressed!' : 'Press Shift'}
 *     </div>
 *   )
 * }
 * ```
 *
 * @example
 * ```tsx
 * function ModifierIndicators() {
 *   const ctrl = useKeyHold('Control')
 *   const shift = useKeyHold('Shift')
 *   const alt = useKeyHold('Alt')
 *
 *   return (
 *     <div>
 *       <span style={{ opacity: ctrl ? 1 : 0.3 }}>Ctrl</span>
 *       <span style={{ opacity: shift ? 1 : 0.3 }}>Shift</span>
 *       <span style={{ opacity: alt ? 1 : 0.3 }}>Alt</span>
 *     </div>
 *   )
 * }
 * ```
 */
export function useKeyHold(key: IndividualKey): boolean {
  const normalizedKey = key.toLowerCase()

  return useKeyState((state) =>
    state.heldKeys.some((heldKey) => heldKey.toLowerCase() === normalizedKey),
  )
}
