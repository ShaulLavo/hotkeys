import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { HotkeyRecorderOptions, HotkeySequenceRecorderOptions } from '@fregat/hotkeys'
import type { UseHotkeyOptions } from './useHotkey.js'
import type { UseHotkeySequenceOptions } from './useHotkeySequence.js'

export interface HotkeysProviderOptions {
  hotkey?: Partial<UseHotkeyOptions>
  hotkeyRecorder?: Partial<HotkeyRecorderOptions>
  hotkeySequence?: Partial<UseHotkeySequenceOptions>
  hotkeySequenceRecorder?: Partial<HotkeySequenceRecorderOptions>
}

interface HotkeysContextValue {
  defaultOptions: HotkeysProviderOptions
}

const HotkeysContext = createContext<HotkeysContextValue | null>(null)

export interface HotkeysProviderProps {
  children: ReactNode
  defaultOptions?: HotkeysProviderOptions
}

const DEFAULT_OPTIONS: HotkeysProviderOptions = {}

export function HotkeysProvider({
  children,
  defaultOptions = DEFAULT_OPTIONS,
}: HotkeysProviderProps) {
  const contextValue: HotkeysContextValue = useMemo(
    () => ({
      defaultOptions,
    }),
    [defaultOptions],
  )

  return (
    // Provider and useContext support React 18, the minimum peer version.
    <HotkeysContext.Provider value={contextValue}>{children}</HotkeysContext.Provider>
  )
}

export function useHotkeysContext() {
  return useContext(HotkeysContext)
}

export function useDefaultHotkeysOptions() {
  const context = useContext(HotkeysContext)
  return context?.defaultOptions ?? {}
}
