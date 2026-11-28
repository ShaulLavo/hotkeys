import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { useSelector } from '@tanstack/react-store'
import { HotkeySequenceRecorder } from '@shaulavo/hotkeys'
import { useRegistryOptions } from './_registry-context.js'
import type { Hotkey, HotkeySequenceRecorderOptions } from '@shaulavo/hotkeys'

export interface ReactHotkeySequenceRecorder {
  /** Whether recording is currently active */
  isRecording: boolean
  /** Chords captured in the current session */
  steps: Hotkey[]
  /** Last committed sequence */
  recordedSequence: Hotkey[] | null
  startRecording: () => void
  stopRecording: () => void
  cancelRecording: () => void
  /** Commit current steps (no-op if empty) */
  commitRecording: () => void
}

/**
 * React hook for recording multi-chord sequences (Vim-style shortcuts).
 * Control functions keep the same identity across renders.
 *
 * @param options - Configuration options for the hotkey sequence recorder
 */
export function useHotkeySequenceRecorder(
  options: HotkeySequenceRecorderOptions,
): ReactHotkeySequenceRecorder {
  const mergedOptions = {
    ...useRegistryOptions().defaultOptions?.hotkeySequenceRecorder,
    ...options,
  }

  const [recorder] = useState(() => new HotkeySequenceRecorder(mergedOptions))

  // Callbacks in the options must see the latest render's values.
  useLayoutEffect(() => {
    recorder.replaceOptions(mergedOptions)
  })

  const isRecording = useSelector(recorder.store, (state) => state.isRecording)
  const steps = useSelector(recorder.store, (state) => state.steps)
  const recordedSequence = useSelector(recorder.store, (state) => state.recordedSequence)

  useEffect(() => () => recorder.dispose(), [recorder])

  const startRecording = useCallback(() => recorder.start(), [recorder])
  const stopRecording = useCallback(() => recorder.stop(), [recorder])
  const cancelRecording = useCallback(() => recorder.cancel(), [recorder])
  const commitRecording = useCallback(() => recorder.commit(), [recorder])

  return {
    isRecording,
    steps,
    recordedSequence,
    startRecording,
    stopRecording,
    cancelRecording,
    commitRecording,
  }
}
