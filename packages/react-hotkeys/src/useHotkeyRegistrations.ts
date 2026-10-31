import { useMemo } from 'react'
import { useSelector } from '@tanstack/react-store'
import { getHotkeyRegistry } from '@fregat/hotkeys'
import type { HotkeyRegistrationView } from '@fregat/hotkeys'

export interface HotkeyRegistrationsResult {
  /** Single-stroke registrations (public view, no callbacks) */
  hotkeys: Array<HotkeyRegistrationView>
  /** Multi-stroke registrations */
  sequences: Array<HotkeyRegistrationView>
}

/**
 * Lists the document registry's registrations, for devtools, palettes and cheat sheets.
 *
 * @example
 * ```tsx
 * function ShortcutList() {
 *   const { hotkeys } = useHotkeyRegistrations()
 *   return hotkeys.map((registration) => <li key={registration.id}>{registration.hotkey}</li>)
 * }
 * ```
 */
export function useHotkeyRegistrations(): HotkeyRegistrationsResult {
  const registry = getHotkeyRegistry()
  const registrations = useSelector(registry.registrations)

  return useMemo(() => {
    const hotkeys: Array<HotkeyRegistrationView> = []
    const sequences: Array<HotkeyRegistrationView> = []
    for (const view of registrations.values()) {
      if (view.strokes.length === 1) hotkeys.push(view)
      else if (view.strokes.length > 1) sequences.push(view)
    }
    return { hotkeys, sequences }
  }, [registrations])
}
