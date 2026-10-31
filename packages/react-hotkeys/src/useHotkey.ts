import { useEffect, useRef } from 'react'
import { getHotkeyRegistry } from '@fregat/hotkeys'
import { useDefaultHotkeysOptions } from './HotkeysProvider.js'
import { registrationIdentity, resolveTarget } from './_registration.js'
import { useIsomorphicLayoutEffect } from './utils.js'
import type {
  HotkeyCallback,
  HotkeyOptions,
  HotkeyRegistrationHandle,
  RegisterableHotkey,
} from '@fregat/hotkeys'

export interface UseHotkeyOptions extends Omit<HotkeyOptions, 'target'> {
  /**
   * The scope checked by the document registry's delegated keyboard listeners.
   * An element target includes its descendants. Accepts a React element ref,
   * an element, document, window, or null. Defaults to document; targets must
   * belong to that document.
   */
  target?: React.RefObject<HTMLElement | null> | HTMLElement | Document | Window | null
}

/**
 * React hook for registering a keyboard hotkey.
 *
 * Registers with the document's hotkey registry, one trie lookup per key.
 * The callback receives both the keyboard event and a context object
 * containing the normalized hotkey string and parsed stroke.
 *
 * This hook syncs the callback and options on every render to avoid
 * stale closures. This means
 * callbacks that reference React state will always have access to
 * the latest values.
 *
 * @param hotkey - The hotkey string (e.g., 'Mod+S', 'Escape') or RawHotkey object (supports `mod` for cross-platform)
 * @param callback - The function to call when the hotkey is pressed
 * @param options - Options for the hotkey behavior. `enabled: false` keeps the registration in the
 *   registry's observable `registrations` store while suppressing keyboard-triggered callbacks.
 *   The hook updates the existing handle instead of unregistering.
 *
 * @example
 * ```tsx
 * function SaveButton() {
 *   const [count, setCount] = useState(0)
 *
 *   // Callback always has access to latest count value
 *   useHotkey('Mod+S', (event, { hotkey }) => {
 *     console.log(`Save triggered, count is ${count}`)
 *     handleSave()
 *   })
 *
 *   return <button onClick={() => setCount(c => c + 1)}>Count: {count}</button>
 * }
 * ```
 *
 * @example
 * ```tsx
 * function Modal({ isOpen, onClose }) {
 *   // enabled option is synced on every render
 *   useHotkey('Escape', () => {
 *     onClose()
 *   }, { enabled: isOpen })
 *
 *   if (!isOpen) return null
 *   return <div className="modal">...</div>
 * }
 * ```
 *
 * @example
 * ```tsx
 * function Editor() {
 *   const editorRef = useRef<HTMLDivElement>(null)
 *
 *   // Scoped to a specific element
 *   useHotkey('Mod+S', () => {
 *     save()
 *   }, { target: editorRef })
 *
 *   return <div ref={editorRef}>...</div>
 * }
 * ```
 */
export function useHotkey(
  hotkey: RegisterableHotkey,
  callback: HotkeyCallback,
  options: UseHotkeyOptions = {},
): void {
  const mergedOptions = {
    ...useDefaultHotkeysOptions().hotkey,
    ...options,
  }

  // Stable ref for registration handle
  const registrationRef = useRef<HotkeyRegistrationHandle | null>(null)

  // Refs to capture current values for use in effect without adding dependencies
  const callbackRef = useRef(callback)
  const optionsRef = useRef(mergedOptions)
  const hotkeyRef = useRef(hotkey)

  // Refs are written after commit; the effects below read them.
  useIsomorphicLayoutEffect(() => {
    callbackRef.current = callback
    optionsRef.current = mergedOptions
    hotkeyRef.current = hotkey
  })

  // Only a different binding requires a new registration handle.
  const registeredIdentityRef = useRef<string | null>(null)

  useEffect(() => {
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

    const identity = registrationIdentity([hotkeyRef.current])
    const hotkeyChanged =
      registeredIdentityRef.current !== null && registeredIdentityRef.current !== identity

    if (registrationRef.current?.isActive && hotkeyChanged) {
      registrationRef.current.unregister()
      registrationRef.current = null
    }

    const currentOptions = { ...optionsRef.current, target: resolvedTarget }
    if (registrationRef.current?.isActive) {
      registrationRef.current.callback = callbackRef.current
      registrationRef.current.replaceOptions(currentOptions)
    } else {
      registrationRef.current = getHotkeyRegistry().register(
        hotkeyRef.current,
        callbackRef.current,
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
