import { useEffect, useRef } from 'react'
import { getHotkeyRegistry } from '@fregat/hotkeys'
import { useDefaultHotkeysOptions } from './HotkeysProvider.js'
import { registrationIdentity, resolveTarget } from './_registration.js'
import { useIsomorphicLayoutEffect } from './utils.js'
import type { UseHotkeyOptions } from './useHotkey.js'
import type { HotkeyCallback, HotkeyRegistrationHandle, RegisterableHotkey } from '@fregat/hotkeys'

/**
 * A single hotkey definition for use with `useHotkeys`.
 */
export interface UseHotkeyDefinition {
  /** The hotkey string (e.g., 'Mod+S', 'Escape') or RawHotkey object */
  hotkey: RegisterableHotkey
  /** The function to call when the hotkey is pressed */
  callback: HotkeyCallback
  /** Per-hotkey options (merged on top of commonOptions) */
  options?: UseHotkeyOptions
}

/**
 * React hook for registering multiple keyboard hotkeys at once.
 *
 * Registers with the document's hotkey registry, one trie lookup per key.
 * Accepts a dynamic array of hotkey definitions, making it safe to use
 * with variable-length lists without violating the rules of hooks.
 *
 * Options are merged in this order:
 * HotkeysProvider defaults < commonOptions < per-definition options
 *
 * Callbacks and options are synced on every render to avoid stale closures.
 *
 * @param hotkeys - Array of hotkey definitions to register
 * @param commonOptions - Shared options applied to all hotkeys (overridden by per-definition options).
 *   Per-row `enabled: false` keeps the row in the registry's observable `registrations` store while
 *   suppressing keyboard-triggered callbacks. Current merged options replace the existing handle's
 *   options without unregister/re-register churn.
 *
 * @example
 * ```tsx
 * function Editor() {
 *   useHotkeys([
 *     { hotkey: 'Mod+S', callback: () => save() },
 *     { hotkey: 'Mod+Z', callback: () => undo() },
 *     { hotkey: 'Escape', callback: () => close() },
 *   ])
 * }
 * ```
 *
 * @example
 * ```tsx
 * function MenuShortcuts({ items }) {
 *   // Dynamic hotkeys from data -- safe because it's a single hook call
 *   useHotkeys(
 *     items.map((item) => ({
 *       hotkey: item.shortcut,
 *       callback: item.action,
 *       options: { enabled: item.enabled },
 *     })),
 *     { preventDefault: true },
 *   )
 * }
 * ```
 */
export function useHotkeys(
  hotkeys: ReadonlyArray<UseHotkeyDefinition>,
  commonOptions: UseHotkeyOptions = {},
): void {
  const defaultOptions = useDefaultHotkeysOptions().hotkey

  const registrationsRef = useRef<Map<string, HotkeyRegistrationHandle>>(new Map())
  const hotkeysRef = useRef(hotkeys)
  const commonOptionsRef = useRef(commonOptions)
  const defaultOptionsRef = useRef(defaultOptions)

  // Refs are written after commit; the effects below read them.
  useIsomorphicLayoutEffect(() => {
    hotkeysRef.current = hotkeys
    commonOptionsRef.current = commonOptions
    defaultOptionsRef.current = defaultOptions
  })

  useEffect(() => {
    const prevRegistrations = registrationsRef.current
    const nextRegistrations = new Map<string, HotkeyRegistrationHandle>()

    const rows: Array<{
      registrationKey: string
      def: (typeof hotkeysRef.current)[number]
      mergedOptions: UseHotkeyOptions
      resolvedTarget: Document | HTMLElement | Window
    }> = []

    for (let i = 0; i < hotkeysRef.current.length; i++) {
      const def = hotkeysRef.current[i]!
      const mergedOptions = {
        ...defaultOptionsRef.current,
        ...commonOptionsRef.current,
        ...def.options,
      }

      const resolvedTarget = resolveTarget(mergedOptions.target)

      if (!resolvedTarget) {
        continue
      }

      const registrationKey = `${i}:${registrationIdentity([def.hotkey])}`
      rows.push({
        registrationKey,
        def,
        mergedOptions,
        resolvedTarget,
      })
    }

    const nextKeys = new Set(rows.map((r) => r.registrationKey))

    for (const [key, handle] of prevRegistrations) {
      if (!nextKeys.has(key) && handle.isActive) {
        handle.unregister()
      }
    }

    for (const row of rows) {
      const { registrationKey, def, mergedOptions, resolvedTarget } = row

      const existing = prevRegistrations.get(registrationKey)
      const currentOptions = { ...mergedOptions, target: resolvedTarget }
      if (existing?.isActive) {
        // Publish callback/options only after commit, never during render.
        existing.callback = def.callback
        existing.replaceOptions(currentOptions)
        nextRegistrations.set(registrationKey, existing)
        continue
      }

      const handle = getHotkeyRegistry().register(def.hotkey, def.callback, currentOptions)
      nextRegistrations.set(registrationKey, handle)
    }

    registrationsRef.current = nextRegistrations
  })

  useEffect(() => {
    return () => {
      for (const handle of registrationsRef.current.values()) {
        if (handle.isActive) {
          handle.unregister()
        }
      }
      registrationsRef.current = new Map()
    }
  }, [])
}
