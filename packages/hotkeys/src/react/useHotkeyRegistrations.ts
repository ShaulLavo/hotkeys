import { useCallback, useMemo } from 'react'
import { getHotkeyRegistry } from '@shaulavo/hotkeys'
import { useRegistryOptions } from './_registry-context.js'
import { useBrowserStore } from './_use-browser-store.js'
import type { HotkeyRegistrationView } from '@shaulavo/hotkeys'

const EMPTY_REGISTRATIONS: ReadonlyMap<string, HotkeyRegistrationView> = new Map()

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
  const { registry } = useRegistryOptions()
  const getRegistrationsStore = useCallback(
    () => (registry ?? getHotkeyRegistry()).registrations,
    [registry],
  )
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
