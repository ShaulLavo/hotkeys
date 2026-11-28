import { createContext, useContext } from 'react'
import type {
  HotkeyRecorderOptions,
  HotkeyRegistry,
  HotkeySequenceRecorderOptions,
} from '@shaulavo/hotkeys'
import type { UseHotkeyOptions } from './useHotkey.js'

export interface HotkeysProviderOptions {
  hotkey?: UseHotkeyOptions
  hotkeyRecorder?: Partial<HotkeyRecorderOptions>
  hotkeySequenceRecorder?: Partial<HotkeySequenceRecorderOptions>
}

type RegistryOptions = {
  readonly registry?: HotkeyRegistry
  readonly defaultOptions?: HotkeysProviderOptions
}

export const RegistryContext = createContext<RegistryOptions>({})
export function useRegistryOptions(): RegistryOptions {
  return useContext(RegistryContext)
}
