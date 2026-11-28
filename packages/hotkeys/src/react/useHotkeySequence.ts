import { useHotkeys } from './useHotkeys.js'
import type { UseHotkeyOptions } from './useHotkey.js'
import type { HotkeyCallback, HotkeySequence } from '@shaulavo/hotkeys'

export function useHotkeySequence(
  sequence: HotkeySequence,
  callback: HotkeyCallback,
  options?: UseHotkeyOptions,
): void {
  useHotkeys([{ sequence, callback, options }])
}
