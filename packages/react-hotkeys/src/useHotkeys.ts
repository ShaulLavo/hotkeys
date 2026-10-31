import { useEffect, useRef } from 'react'
import { detectPlatform, getHotkeyRegistry, normalizeRegisterableHotkey } from '@fregat/hotkeys'
import { useDefaultHotkeysOptions } from './HotkeysProvider.js'
import { isRef, useIsomorphicLayoutEffect } from './utils.js'
import type { UseHotkeyOptions } from './useHotkey.js'
import type {
  Hotkey,
  HotkeyCallback,
  HotkeyRegistrationHandle,
  RegisterableHotkey,
} from '@fregat/hotkeys'

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
 *   suppressing keyboard-triggered callbacks. Toggling `enabled` updates the existing handle via
 *   `setOptions` (no unregister/re-register churn).
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
  type RegistrationRecord = {
    handle: HotkeyRegistrationHandle
    target: Document | HTMLElement | Window
  }

  const defaultOptions = useDefaultHotkeysOptions().hotkey
  const platform = commonOptions.platform ?? defaultOptions?.platform ?? detectPlatform()

  const registrationsRef = useRef<Map<string, RegistrationRecord>>(new Map())
  const hotkeysRef = useRef(hotkeys)
  const hotkeyStringsRef = useRef<Array<Hotkey>>([])
  const commonOptionsRef = useRef(commonOptions)
  const defaultOptionsRef = useRef(defaultOptions)

  const hotkeyStrings = hotkeys.map((def) =>
    normalizeRegisterableHotkey(def.hotkey, def.options?.platform ?? platform),
  )

  // Refs are written after commit; the effects below read them.
  useIsomorphicLayoutEffect(() => {
    hotkeysRef.current = hotkeys
    hotkeyStringsRef.current = hotkeyStrings
    commonOptionsRef.current = commonOptions
    defaultOptionsRef.current = defaultOptions
  })

  useEffect(() => {
    const prevRegistrations = registrationsRef.current
    const nextRegistrations = new Map<string, RegistrationRecord>()

    const rows: Array<{
      registrationKey: string
      def: (typeof hotkeysRef.current)[number]
      hotkeyStr: Hotkey
      mergedOptions: UseHotkeyOptions
      resolvedTarget: Document | HTMLElement | Window
    }> = []

    for (let i = 0; i < hotkeysRef.current.length; i++) {
      const def = hotkeysRef.current[i]!
      const hotkeyStr = hotkeyStringsRef.current[i]!
      const mergedOptions = {
        ...defaultOptionsRef.current,
        ...commonOptionsRef.current,
        ...def.options,
      }

      const resolvedTarget = isRef(mergedOptions.target)
        ? mergedOptions.target.current
        : (mergedOptions.target ?? (typeof document !== 'undefined' ? document : null))

      if (!resolvedTarget) {
        continue
      }

      const registrationKey = `${i}:${hotkeyStr}`
      rows.push({
        registrationKey,
        def,
        hotkeyStr,
        mergedOptions,
        resolvedTarget,
      })
    }

    const nextKeys = new Set(rows.map((r) => r.registrationKey))

    for (const [key, record] of prevRegistrations) {
      if (!nextKeys.has(key) && record.handle.isActive) {
        record.handle.unregister()
      }
    }

    for (const row of rows) {
      const { registrationKey, def, hotkeyStr, mergedOptions, resolvedTarget } = row

      const existing = prevRegistrations.get(registrationKey)
      if (existing?.handle.isActive && existing.target === resolvedTarget) {
        // Publish callback/options only after commit, never during render.
        existing.handle.callback = def.callback
        const { target: _target, ...optionsWithoutTarget } = mergedOptions
        existing.handle.setOptions(optionsWithoutTarget)
        nextRegistrations.set(registrationKey, existing)
        continue
      }

      if (existing?.handle.isActive) {
        existing.handle.unregister()
      }

      const handle = getHotkeyRegistry().register(hotkeyStr, def.callback, {
        ...mergedOptions,
        target: resolvedTarget,
      })
      nextRegistrations.set(registrationKey, {
        handle,
        target: resolvedTarget,
      })
    }

    registrationsRef.current = nextRegistrations
  })

  useEffect(() => {
    return () => {
      for (const { handle } of registrationsRef.current.values()) {
        if (handle.isActive) {
          handle.unregister()
        }
      }
      registrationsRef.current = new Map()
    }
  }, [])
}
