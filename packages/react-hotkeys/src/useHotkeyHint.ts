import { matchesHeldModifiers } from '@fregat/hotkeys'
import { useKeyState } from './_use-key-state.js'
import type { HeldModifierOptions, RegisterableHotkey } from '@fregat/hotkeys'

/**
 * Returns a boolean indicating whether held modifiers reveal this shortcut.
 * Only visibility changes from held-key updates cause a rerender.
 * Uses the nonempty-subset/AltGr rules of `matchesHeldModifiers`; `exact` requires
 * every modifier. Combine with the action's enabled state before showing a badge.
 * This helper does not register a shortcut or check whether its target is focused.
 */
export function useHotkeyHint(
  hotkey: RegisterableHotkey,
  options: HeldModifierOptions = {},
): boolean {
  return useKeyState((state) => matchesHeldModifiers(hotkey, state.heldKeys, options))
}
