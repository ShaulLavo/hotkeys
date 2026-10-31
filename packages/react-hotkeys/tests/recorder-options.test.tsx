import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HotkeysProvider } from '../src/HotkeysProvider.js'
import { useHotkeyRecorder } from '../src/useHotkeyRecorder.js'
import { useHotkeySequenceRecorder } from '../src/useHotkeySequenceRecorder.js'
import type { PropsWithChildren } from 'react'
import type { HotkeyRecorderOptions, HotkeySequenceRecorderOptions } from '@fregat/hotkeys'
import type { HotkeysProviderOptions } from '../src/HotkeysProvider.js'

type RecorderOptions = HotkeyRecorderOptions & HotkeySequenceRecorderOptions

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  document.body.replaceChildren()
})

function press(key: string, code: string, target: EventTarget = document): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true })
  act(() => target.dispatchEvent(event))
  return event
}

describe.each([
  { name: 'hotkey', useRecorder: useHotkeyRecorder },
  { name: 'sequence', useRecorder: useHotkeySequenceRecorder },
])('$name recorder render options', ({ name, useRecorder }) => {
  it('drops omitted cancel and clear callbacks during an active recording', () => {
    const onRecord = vi.fn()
    const onCancel = vi.fn()
    const onClear = vi.fn()
    const { result, rerender } = renderHook<ReturnType<typeof useRecorder>, RecorderOptions>(
      (options) => useRecorder(options),
      {
        initialProps: { onRecord, onCancel, onClear },
      },
    )
    act(result.current.startRecording)
    rerender({ onRecord })
    expect(result.current.isRecording).toBe(true)
    press('Escape', 'Escape')
    expect(onCancel).not.toHaveBeenCalled()
    act(result.current.startRecording)
    press('Backspace', 'Backspace')
    expect(onClear).not.toHaveBeenCalled()
    expect(onRecord).not.toHaveBeenCalled()
  })

  it('drops omitted validation and rejection callbacks and records with the current callback', () => {
    const originalRecord = vi.fn()
    const latestRecord = vi.fn()
    const validate = vi.fn(() => false)
    const onReject = vi.fn()
    const { result, rerender } = renderHook<ReturnType<typeof useRecorder>, RecorderOptions>(
      (options) => useRecorder(options),
      {
        initialProps: { onRecord: originalRecord, validate, onReject, platform: 'linux' },
      },
    )
    act(result.current.startRecording)
    rerender({ onRecord: latestRecord, platform: 'linux' })
    press('s', '')
    expect(onReject).not.toHaveBeenCalled()
    expect(result.current.isRecording).toBe(true)
    press('s', 'KeyS')
    if (name === 'sequence') press('Enter', 'Enter')
    expect(validate).not.toHaveBeenCalled()
    expect(originalRecord).not.toHaveBeenCalled()
    expect(latestRecord).toHaveBeenCalledExactlyOnceWith(
      name === 'sequence' ? ['[KeyS]'] : '[KeyS]',
    )
  })

  it('restores recording defaults while keeping progress and action identities', () => {
    const onRecord = vi.fn()
    const { result, rerender } = renderHook<ReturnType<typeof useRecorder>, RecorderOptions>(
      (options) => useRecorder(options),
      {
        initialProps: {
          onRecord,
          recordBy: 'key',
          ignoreInputs: false,
          commitKeys: 'none',
          commitOnEnter: false,
          platform: 'linux',
        },
      },
    )
    const actions = result.current
    act(actions.startRecording)
    if (name === 'sequence') press('g', 'KeyG')
    rerender({ onRecord, platform: 'linux' })
    expect(result.current.isRecording).toBe(true)
    expect(result.current.startRecording).toBe(actions.startRecording)
    expect(result.current.stopRecording).toBe(actions.stopRecording)
    expect(result.current.cancelRecording).toBe(actions.cancelRecording)
    if ('steps' in result.current && 'commitRecording' in actions) {
      expect(result.current.steps).toEqual(['G'])
      expect(result.current.commitRecording).toBe(actions.commitRecording)
    }

    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    expect(press('s', 'KeyS', input).defaultPrevented).toBe(false)
    expect(onRecord).not.toHaveBeenCalled()
    input.remove()
    press('h', 'KeyH')
    if (name === 'sequence') press('Enter', 'Enter')
    expect(onRecord).toHaveBeenCalledExactlyOnceWith(
      name === 'sequence' ? ['G', '[KeyH]'] : '[KeyH]',
    )
    expect(result.current.isRecording).toBe(false)
  })

  it('falls back to provider options and forgets a removed provider callback', () => {
    const onRecord = vi.fn()
    const overrideCancel = vi.fn()
    const providerCancel = vi.fn()
    let defaults: HotkeysProviderOptions = {
      hotkeyRecorder: { onCancel: providerCancel },
      hotkeySequenceRecorder: { onCancel: providerCancel },
    }
    const wrapper = ({ children }: PropsWithChildren) => (
      <HotkeysProvider defaultOptions={defaults}>{children}</HotkeysProvider>
    )
    const { result, rerender } = renderHook<ReturnType<typeof useRecorder>, RecorderOptions>(
      (options) => useRecorder(options),
      {
        initialProps: { onRecord, onCancel: overrideCancel },
        wrapper,
      },
    )
    act(result.current.startRecording)
    press('Escape', 'Escape')
    expect(overrideCancel).toHaveBeenCalledTimes(1)
    expect(providerCancel).not.toHaveBeenCalled()

    rerender({ onRecord })
    act(result.current.startRecording)
    press('Escape', 'Escape')
    expect(providerCancel).toHaveBeenCalledTimes(1)
    expect(overrideCancel).toHaveBeenCalledTimes(1)

    defaults = {}
    rerender({ onRecord })
    act(result.current.startRecording)
    press('Escape', 'Escape')
    expect(providerCancel).toHaveBeenCalledTimes(1)
    expect(overrideCancel).toHaveBeenCalledTimes(1)
  })
})

describe('sequence recorder idle options after React commits', () => {
  it('reschedules a changed idle timeout from the options update', () => {
    vi.useFakeTimers()
    const originalRecord = vi.fn()
    const latestRecord = vi.fn()
    const { result, rerender } = renderHook<
      ReturnType<typeof useHotkeySequenceRecorder>,
      HotkeySequenceRecorderOptions
    >((options) => useHotkeySequenceRecorder(options), {
      initialProps: { onRecord: originalRecord, idleTimeoutMs: 100 },
    })
    act(result.current.startRecording)
    press('g', 'KeyG')
    act(() => vi.advanceTimersByTime(60))
    rerender({ onRecord: latestRecord, idleTimeoutMs: 200 })
    act(() => vi.advanceTimersByTime(40))
    expect(latestRecord).not.toHaveBeenCalled()
    expect(result.current.steps).toEqual(['[KeyG]'])
    act(() => vi.advanceTimersByTime(159))
    expect(latestRecord).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(latestRecord).toHaveBeenCalledExactlyOnceWith(['[KeyG]'])
    expect(originalRecord).not.toHaveBeenCalled()
  })

  it('cancels an old idle deadline when the timeout prop disappears', () => {
    vi.useFakeTimers()
    const onRecord = vi.fn()
    const { result, rerender } = renderHook<
      ReturnType<typeof useHotkeySequenceRecorder>,
      HotkeySequenceRecorderOptions
    >((options) => useHotkeySequenceRecorder(options), {
      initialProps: { onRecord, idleTimeoutMs: 100 },
    })
    act(result.current.startRecording)
    press('g', 'KeyG')
    act(() => vi.advanceTimersByTime(40))
    rerender({ onRecord })
    act(() => vi.advanceTimersByTime(500))
    expect(onRecord).not.toHaveBeenCalled()
    expect(result.current.isRecording).toBe(true)
    expect(result.current.steps).toEqual(['[KeyG]'])
    act(result.current.commitRecording)
    expect(onRecord).toHaveBeenCalledExactlyOnceWith(['[KeyG]'])
  })

  it('does not postpone the deadline on unrelated rerenders or callback updates', () => {
    vi.useFakeTimers()
    const originalRecord = vi.fn()
    const latestRecord = vi.fn()
    const { result, rerender } = renderHook<
      ReturnType<typeof useHotkeySequenceRecorder>,
      HotkeySequenceRecorderOptions
    >((options) => useHotkeySequenceRecorder(options), {
      initialProps: { onRecord: originalRecord, idleTimeoutMs: 100 },
    })
    act(result.current.startRecording)
    press('g', 'KeyG')
    act(() => vi.advanceTimersByTime(60))
    rerender({ onRecord: latestRecord, idleTimeoutMs: 100 })
    act(() => vi.advanceTimersByTime(39))
    expect(latestRecord).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(latestRecord).toHaveBeenCalledExactlyOnceWith(['[KeyG]'])
    expect(originalRecord).not.toHaveBeenCalled()
  })
})
