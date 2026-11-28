import { useHotkeys } from './useHotkeys.js'
import type {
  HotkeyCallback,
  HotkeyOptions,
  HotkeyStroke,
  HotkeyTarget,
  Shortcut,
} from '@shaulavo/hotkeys'
import type { RefObject } from 'react'

export interface UseHotkeyOptions extends Omit<HotkeyOptions, 'target'> {
  target?: RefObject<HTMLElement | null> | HotkeyTarget | null
}

export function useHotkey(
  hotkey: HotkeyStroke | Shortcut,
  callback: HotkeyCallback,
  options?: UseHotkeyOptions,
): void {
  useHotkeys([{ hotkey, callback, options }])
}
