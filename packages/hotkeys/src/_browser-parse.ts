import { keyInputFromKeyboardEvent } from './adapters/browser.js'
import type { KeyboardEventLike } from './adapters/browser.js'
import { normalizeHotkeyFromKeyInput, parseKeyInput } from './parse.js'
import { detectPlatform } from './platform.js'
import type { Hotkey, ParsedHotkey } from './hotkey.types.js'

/**
 * Parses a keyboard event into a ParsedHotkey.
 *
 * @example
 * ```ts
 * document.addEventListener('keydown', (event) => {
 *   const parsed = parseKeyboardEvent(event)
 *   console.log(parsed) // { key: 'S', ctrl: true, shift: false, ... }
 * })
 * ```
 */
export function parseKeyboardEvent(
  event: KeyboardEventLike,
  platform?: 'mac' | 'windows' | 'linux',
): ParsedHotkey {
  return parseKeyInput(keyInputFromKeyboardEvent(event, platform))
}

/** Normalizes a keyboard event to the same canonical hotkey string as `normalizeHotkey`. */
export function normalizeHotkeyFromEvent(
  event: KeyboardEventLike,
  platform: 'mac' | 'windows' | 'linux' = detectPlatform(),
): Hotkey {
  return normalizeHotkeyFromKeyInput(keyInputFromKeyboardEvent(event, platform), platform)
}
