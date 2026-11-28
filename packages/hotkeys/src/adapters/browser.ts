import { createKeyInput } from '../key-input.js'
import type { Platform } from '../platform.js'
import type { KeyInput } from '../key-input.js'

/** The fields of a DOM `KeyboardEvent` the adapter reads; structural so the core needs no DOM types. */
export interface KeyboardEventLike {
  type: string
  key: string
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  repeat?: boolean
  isComposing?: boolean
  /** 229 marks a key the IME is processing in browsers that leave `isComposing` false. */
  keyCode?: number
  getModifierState?: (modifier: string) => boolean
}

/** Converts a browser keyboard event into a {@link KeyInput}. */
export function keyInputFromKeyboardEvent(event: KeyboardEventLike, platform?: Platform): KeyInput {
  return createKeyInput({
    type: event.type === 'keyup' ? 'keyup' : 'keydown',
    key: event.key || '',
    code: event.code || '',
    modifiers: {
      ctrl: Boolean(event.ctrlKey),
      shift: Boolean(event.shiftKey),
      alt: Boolean(event.altKey),
      meta: Boolean(event.metaKey),
      altGraph: readAltGraph(event, platform),
    },
    repeat: Boolean(event.repeat),
    composing: Boolean(event.isComposing) || event.keyCode === 229,
  })
}

function readAltGraph(event: KeyboardEventLike, platform?: Platform): boolean {
  // WebKit reports AltGraph for Option on some macOS layouts, where Option stays a shortcut modifier.
  if (platform === 'mac' || typeof event.getModifierState !== 'function') return false
  try {
    return event.getModifierState('AltGraph')
  } catch {
    // Synthetic events and older browsers may not implement this reliably.
    return false
  }
}
