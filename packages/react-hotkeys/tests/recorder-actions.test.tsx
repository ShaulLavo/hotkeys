import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useHotkeyRecorder } from '../src/useHotkeyRecorder.js'
import { useHotkeySequenceRecorder } from '../src/useHotkeySequenceRecorder.js'
import type { HotkeyRecorderOptions, HotkeySequenceRecorderOptions } from '@fregat/hotkeys'

afterEach(() => {
  cleanup()
})

function press(key: string, code: string): void {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }),
    )
  })
}

describe.each([false, true])('recorder actions (StrictMode: %s)', (reactStrictMode) => {
  it('keeps hotkey actions stable while using current callbacks and cleaning up on unmount', () => {
    const initialRecord = vi.fn()
    const initialCancel = vi.fn()
    const latestRecord = vi.fn()
    const latestCancel = vi.fn()
    const { result, rerender, unmount } = renderHook(
      (options: HotkeyRecorderOptions) => useHotkeyRecorder(options),
      {
        initialProps: {
          onRecord: initialRecord,
          onCancel: initialCancel,
          recordBy: 'key',
          platform: 'linux',
        },
        reactStrictMode,
      },
    )
    const actions = result.current

    function expectStableActions(): void {
      expect(result.current.startRecording).toBe(actions.startRecording)
      expect(result.current.stopRecording).toBe(actions.stopRecording)
      expect(result.current.cancelRecording).toBe(actions.cancelRecording)
    }

    act(actions.startRecording)
    expect(result.current.isRecording).toBe(true)
    expectStableActions()

    rerender({
      onRecord: latestRecord,
      onCancel: latestCancel,
      recordBy: 'key',
      platform: 'linux',
    })
    expectStableActions()

    press('s', 'KeyS')
    expect(latestRecord).toHaveBeenCalledExactlyOnceWith('S')
    expect(initialRecord).not.toHaveBeenCalled()
    expect(result.current.recordedHotkey).toBe('S')
    expect(result.current.isRecording).toBe(false)
    expectStableActions()

    act(actions.startRecording)
    act(actions.stopRecording)
    expect(result.current.isRecording).toBe(false)
    expect(latestCancel).not.toHaveBeenCalled()

    act(actions.startRecording)
    act(actions.cancelRecording)
    expect(latestCancel).toHaveBeenCalledTimes(1)
    expect(initialCancel).not.toHaveBeenCalled()
    expectStableActions()

    act(actions.startRecording)
    unmount()
    press('a', 'KeyA')
    expect(latestRecord).toHaveBeenCalledTimes(1)
    expect(latestCancel).toHaveBeenCalledTimes(1)
  })

  it('keeps sequence actions stable through editing, committing and cancelling', () => {
    const initialRecord = vi.fn()
    const initialCancel = vi.fn()
    const latestRecord = vi.fn()
    const latestCancel = vi.fn()
    const { result, rerender, unmount } = renderHook(
      (options: HotkeySequenceRecorderOptions) => useHotkeySequenceRecorder(options),
      {
        initialProps: {
          onRecord: initialRecord,
          onCancel: initialCancel,
          recordBy: 'key',
          platform: 'linux',
        },
        reactStrictMode,
      },
    )
    const actions = result.current

    function expectStableActions(): void {
      expect(result.current.startRecording).toBe(actions.startRecording)
      expect(result.current.stopRecording).toBe(actions.stopRecording)
      expect(result.current.cancelRecording).toBe(actions.cancelRecording)
      expect(result.current.commitRecording).toBe(actions.commitRecording)
    }

    act(actions.startRecording)
    press('g', 'KeyG')
    expect(result.current.isRecording).toBe(true)
    expect(result.current.steps).toEqual(['G'])
    expectStableActions()

    rerender({
      onRecord: latestRecord,
      onCancel: latestCancel,
      recordBy: 'key',
      platform: 'linux',
    })
    expectStableActions()

    press('h', 'KeyH')
    act(actions.commitRecording)
    expect(latestRecord).toHaveBeenCalledExactlyOnceWith(['G', 'H'])
    expect(initialRecord).not.toHaveBeenCalled()
    expect(result.current.recordedSequence).toEqual(['G', 'H'])
    expect(result.current.steps).toEqual([])
    expect(result.current.isRecording).toBe(false)
    expectStableActions()

    act(actions.startRecording)
    press('d', 'KeyD')
    act(actions.stopRecording)
    expect(result.current.steps).toEqual([])
    expect(result.current.isRecording).toBe(false)
    expect(latestCancel).not.toHaveBeenCalled()

    act(actions.startRecording)
    act(actions.cancelRecording)
    expect(latestCancel).toHaveBeenCalledTimes(1)
    expect(initialCancel).not.toHaveBeenCalled()
    expectStableActions()

    act(actions.startRecording)
    press('j', 'KeyJ')
    unmount()
    press('Enter', 'Enter')
    expect(latestRecord).toHaveBeenCalledTimes(1)
    expect(latestCancel).toHaveBeenCalledTimes(1)
  })
})
