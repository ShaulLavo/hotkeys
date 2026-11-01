import { useDefaultHotkeysOptions } from './HotkeysProvider.js'
import { useBatchRegistrations } from './_batch-registration.js'
import type { UseHotkeyOptions } from './useHotkey.js'
import type { HotkeyCallback, RegisterableHotkey } from '@fregat/hotkeys'

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
  useBatchRegistrations(
    hotkeys.map((definition) => ({
      keys: [definition.hotkey],
      callback: definition.callback,
      options: definition.options,
    })),
    commonOptions,
    defaultOptions,
  )
}
