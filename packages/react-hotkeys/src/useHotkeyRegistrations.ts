import { useMemo } from 'react'
import { getHotkeyRegistry } from '@fregat/hotkeys'
import { useBrowserStore } from './_use-browser-store.js'
import type { HotkeyRegistrationView } from '@fregat/hotkeys'

const EMPTY_REGISTRATIONS: ReadonlyMap<string, HotkeyRegistrationView> = new Map()
const getRegistrationsStore = () => getHotkeyRegistry().registrations

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
  const registrations = useBrowserStore(
    getRegistrationsStore,
    EMPTY_REGISTRATIONS,
    (state) => state,
  )

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
