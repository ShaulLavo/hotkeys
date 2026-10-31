import { useEffect, useRef } from 'react'
import { getHotkeyRegistry } from '@fregat/hotkeys'
import { useDefaultHotkeysOptions } from './HotkeysProvider.js'
import { registrationIdentity, resolveTarget } from './_registration.js'
import { useIsomorphicLayoutEffect } from './utils.js'
import type {
  HotkeyCallback,
  HotkeySequence,
  HotkeyOptions,
  HotkeyRegistrationHandle,
} from '@fregat/hotkeys'

export interface UseHotkeySequenceOptions extends Omit<HotkeyOptions, 'target'> {
  /**
   * The scope checked by the document registry's delegated keyboard listeners.
   * An element target includes its descendants. Accepts a React element ref,
   * an element, document, window, or null. Defaults to document; targets must
   * belong to that document.
   */
  target?: React.RefObject<HTMLElement | null> | HTMLElement | Document | Window | null
}

/**
 * React hook for registering a keyboard shortcut sequence (Vim-style).
 *
 * This hook allows you to register multi-key sequences like 'g g' or 'd d'
 * that trigger when the full sequence is pressed; prefixes wait for the next key.
 *
 * Each step may include modifiers. You can chain the same modifier across
 * steps (e.g. `Shift+R` then `Shift+T`). Modifier-only keydown events (Shift,
 * Control, Alt, or Meta pressed alone) are ignored while matching—they do not
 * advance the sequence or reset progress.
 *
 * @param sequence - Array of hotkey strings that form the sequence
 * @param callback - Function to call when the sequence is completed
 * @param options - Options for the sequence behavior. `enabled: false` keeps the registration in the
 *   registry's observable `registrations` store while suppressing keyboard-triggered callbacks.
 *   The hook updates the existing handle instead of unregistering.
 *
 * @example
 * ```tsx
 * function VimEditor() {
 *   // 'g g' to go to top
 *   useHotkeySequence(['G', 'G'], () => {
 *     scrollToTop()
 *   })
 *
 *   // 'd d' to delete line
 *   useHotkeySequence(['D', 'D'], () => {
 *     deleteLine()
 *   })
 *
 *   // 'd i w' to delete inner word
 *   useHotkeySequence(['D', 'I', 'W'], () => {
 *     deleteInnerWord()
 *   }, { requireReset: true })
 *
 *   // Same modifier on consecutive steps (bare Shift between chords is ignored)
 *   useHotkeySequence(['Shift+R', 'Shift+T'], () => {
 *     nextAction()
 *   })
 *
 *   return <div>...</div>
 * }
 * ```
 */
export function useHotkeySequence(
  sequence: Readonly<HotkeySequence>,
  callback: HotkeyCallback,
  options: UseHotkeySequenceOptions = {},
): void {
  const mergedOptions = {
    ...useDefaultHotkeysOptions().hotkeySequence,
    ...options,
  }

  // Stable ref for registration handle
  const registrationRef = useRef<HotkeyRegistrationHandle | null>(null)

  // Refs to capture current values for use in effect without adding dependencies
  const callbackRef = useRef(callback)
  const optionsRef = useRef(mergedOptions)
  const sequenceRef = useRef(sequence)

  // Refs are written after commit; the effects below read them.
  useIsomorphicLayoutEffect(() => {
    callbackRef.current = callback
    optionsRef.current = mergedOptions
    sequenceRef.current = sequence
  })

  // Only a different binding requires a new registration handle.
  const registeredIdentityRef = useRef<string | null>(null)

  useEffect(() => {
    if (sequenceRef.current.length === 0) {
      if (registrationRef.current?.isActive) {
        registrationRef.current.unregister()
        registrationRef.current = null
      }
      registeredIdentityRef.current = null
      return
    }

    // Resolve target inside the effect so refs are already attached after mount
    const resolvedTarget = resolveTarget(optionsRef.current.target)

    // Wait until the target is available, for example when a ref is attached.
    if (!resolvedTarget) {
      if (registrationRef.current?.isActive) {
        registrationRef.current.unregister()
        registrationRef.current = null
      }
      registeredIdentityRef.current = null
      return
    }

    const identity = registrationIdentity(sequenceRef.current)
    const sequenceChanged =
      registeredIdentityRef.current !== null && registeredIdentityRef.current !== identity

    if (registrationRef.current?.isActive && sequenceChanged) {
      registrationRef.current.unregister()
      registrationRef.current = null
    }

    const currentOptions = { ...optionsRef.current, target: resolvedTarget }
    const currentCallback: HotkeyCallback = (event, context) => callbackRef.current(event, context)
    if (registrationRef.current?.isActive) {
      registrationRef.current.callback = currentCallback
      registrationRef.current.replaceOptions(currentOptions)
    } else {
      registrationRef.current = getHotkeyRegistry().register(
        sequenceRef.current,
        currentCallback,
        currentOptions,
      )
    }

    registeredIdentityRef.current = identity
  })

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (registrationRef.current?.isActive) {
        registrationRef.current.unregister()
        registrationRef.current = null
      }
    }
  }, [])
}
