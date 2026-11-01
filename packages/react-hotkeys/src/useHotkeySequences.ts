import { useDefaultHotkeysOptions } from './HotkeysProvider.js'
import { useBatchRegistrations } from './_batch-registration.js'
import type { UseHotkeySequenceOptions } from './useHotkeySequence.js'
import type { HotkeyCallback, HotkeySequence } from '@fregat/hotkeys'

/**
 * A single sequence definition for use with `useHotkeySequences`.
 * The sequence type defaults to a mutable array for definition builders.
 */
export interface UseHotkeySequenceDefinition<
  Sequence extends Readonly<HotkeySequence> = HotkeySequence,
> {
  /** Array of hotkey strings that form the sequence */
  sequence: Sequence
  /** The function to call when the sequence is completed */
  callback: HotkeyCallback
  /** Per-sequence options (merged on top of commonOptions) */
  options?: UseHotkeySequenceOptions
}

/**
 * React hook for registering multiple keyboard shortcut sequences at once (Vim-style).
 *
 * Registers with the document's hotkey registry. Accepts a dynamic array of definitions so you can
 * register variable-length lists without violating the rules of hooks.
 *
 * Options are merged in this order:
 * HotkeysProvider defaults < commonOptions < per-definition options
 *
 * Callbacks and options are synced on every render to avoid stale closures.
 *
 * Definitions with an empty `sequence` are skipped (no registration).
 *
 * @param definitions - Array of sequence definitions to register
 * @param commonOptions - Shared options applied to all sequences (overridden by per-definition options).
 *   Per-row `enabled: false` keeps the row in the registry's observable `registrations` store while
 *   suppressing keyboard-triggered callbacks. Current merged options replace the existing handle's
 *   options without unregister/re-register churn.
 *
 * @example
 * ```tsx
 * function VimPalette() {
 *   useHotkeySequences([
 *     { sequence: ['G', 'G'], callback: () => scrollToTop() },
 *     { sequence: ['D', 'D'], callback: () => deleteLine() },
 *     { sequence: ['C', 'I', 'W'], callback: () => changeInnerWord(), options: { requireReset: true } },
 *   ])
 * }
 * ```
 *
 * @example
 * ```tsx
 * function DynamicSequences({ items }) {
 *   useHotkeySequences(
 *     items.map((item) => ({
 *       sequence: item.chords,
 *       callback: item.action,
 *       options: { enabled: item.enabled },
 *     })),
 *     { preventDefault: true },
 *   )
 * }
 * ```
 */
export function useHotkeySequences(
  definitions: ReadonlyArray<UseHotkeySequenceDefinition<Readonly<HotkeySequence>>>,
  commonOptions: UseHotkeySequenceOptions = {},
): void {
  const defaultOptions = useDefaultHotkeysOptions().hotkeySequence
  useBatchRegistrations(
    definitions.map((definition) => ({
      keys: definition.sequence,
      callback: definition.callback,
      options: definition.options,
    })),
    commonOptions,
    defaultOptions,
  )
}
