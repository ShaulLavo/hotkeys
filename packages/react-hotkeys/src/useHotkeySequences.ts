import { useEffect, useRef } from 'react'
import { getHotkeyRegistry } from '@fregat/hotkeys'
import { useDefaultHotkeysOptions } from './HotkeysProvider.js'
import { registrationIdentity, resolveTarget } from './_registration.js'
import { useIsomorphicLayoutEffect } from './utils.js'
import type { UseHotkeySequenceOptions } from './useHotkeySequence.js'
import type { HotkeyCallback, HotkeySequence, HotkeyRegistrationHandle } from '@fregat/hotkeys'

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

  const registrationsRef = useRef<Map<string, HotkeyRegistrationHandle>>(new Map())
  const definitionsRef = useRef(definitions)
  const commonOptionsRef = useRef(commonOptions)
  const defaultOptionsRef = useRef(defaultOptions)

  // Refs are written after commit; the effects below read them.
  useIsomorphicLayoutEffect(() => {
    definitionsRef.current = definitions
    commonOptionsRef.current = commonOptions
    defaultOptionsRef.current = defaultOptions
  })

  useEffect(() => {
    const prevRegistrations = registrationsRef.current
    const nextRegistrations = new Map<string, HotkeyRegistrationHandle>()

    const rows: Array<{
      registrationKey: string
      def: (typeof definitionsRef.current)[number]
      seq: Readonly<HotkeySequence>
      mergedOptions: UseHotkeySequenceOptions
      resolvedTarget: Document | HTMLElement | Window
    }> = []

    for (let i = 0; i < definitionsRef.current.length; i++) {
      const def = definitionsRef.current[i]!
      const seq = def.sequence
      if (seq.length === 0) {
        continue
      }

      const mergedOptions = {
        ...defaultOptionsRef.current,
        ...commonOptionsRef.current,
        ...def.options,
      }

      const resolvedTarget = resolveTarget(mergedOptions.target)

      if (!resolvedTarget) {
        continue
      }

      const registrationKey = `${i}:${registrationIdentity(seq)}`
      rows.push({
        registrationKey,
        def,
        seq,
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
      const { registrationKey, def, seq, mergedOptions, resolvedTarget } = row

      const existing = prevRegistrations.get(registrationKey)
      const currentOptions = { ...mergedOptions, target: resolvedTarget }
      if (existing?.isActive) {
        // Publish callback/options only after commit, never during render.
        existing.callback = def.callback
        existing.replaceOptions(currentOptions)
        nextRegistrations.set(registrationKey, existing)
        continue
      }

      const handle = getHotkeyRegistry().register(seq, def.callback, currentOptions)
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
