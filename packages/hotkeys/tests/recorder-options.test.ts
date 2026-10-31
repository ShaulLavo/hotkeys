import { afterEach, describe, expect, it, vi } from 'vitest'
import { HotkeyRecorder, HotkeySequenceRecorder } from '../src/index.js'
import type { HotkeyRecorderOptions, HotkeySequenceRecorderOptions } from '../src/index.js'

type RecorderOptions = HotkeyRecorderOptions & HotkeySequenceRecorderOptions
const recorders: Array<HotkeyRecorder | HotkeySequenceRecorder> = []

afterEach(() => {
  for (const recorder of recorders.splice(0)) recorder.destroy()
  vi.useRealTimers()
  document.body.replaceChildren()
})

function press(key: string, code: string, target: EventTarget = document): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

describe.each([
  { name: 'hotkey', Recorder: HotkeyRecorder },
  { name: 'sequence', Recorder: HotkeySequenceRecorder },
])('$name recorder option updates', ({ name, Recorder }) => {
  function create(options: RecorderOptions) {
    const recorder = new Recorder(options)
    recorders.push(recorder)
    return recorder
  }

  it('keeps setOptions as a patch, preserving omitted settings and callbacks', () => {
    const originalRecord = vi.fn()
    const latestRecord = vi.fn()
    const onCancel = vi.fn()
    const recorder = create({
      onRecord: originalRecord,
      onCancel,
      recordBy: 'key',
      ignoreInputs: false,
      platform: 'linux',
    })
    recorder.start()
    recorder.setOptions({ onRecord: latestRecord })
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    expect(press('s', 'KeyS', input).defaultPrevented).toBe(true)
    if (name === 'sequence') press('Enter', 'Enter', input)
    expect(latestRecord).toHaveBeenCalledExactlyOnceWith(name === 'sequence' ? ['S'] : 'S')
    expect(originalRecord).not.toHaveBeenCalled()
    recorder.start()
    recorder.cancel()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('replaces settings with defaults without discarding an active recording', () => {
    const originalRecord = vi.fn()
    const latestRecord = vi.fn()
    const recorder = create({
      onRecord: originalRecord,
      recordBy: 'key',
      ignoreInputs: false,
      commitKeys: 'none',
      commitOnEnter: false,
      platform: 'linux',
    })
    recorder.start()
    if (name === 'sequence') press('g', 'KeyG')
    recorder.replaceOptions({ onRecord: latestRecord, platform: 'linux' })
    expect(recorder.store.state.isRecording).toBe(true)
    if (recorder instanceof HotkeySequenceRecorder)
      expect(recorder.store.state.steps).toEqual(['G'])

    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    expect(press('s', 'KeyS', input).defaultPrevented).toBe(false)
    expect(latestRecord).not.toHaveBeenCalled()
    input.remove()
    press('h', 'KeyH')
    if (name === 'sequence') press('Enter', 'Enter')
    expect(latestRecord).toHaveBeenCalledExactlyOnceWith(
      name === 'sequence' ? ['G', '[KeyH]'] : '[KeyH]',
    )
    expect(originalRecord).not.toHaveBeenCalled()
    expect(recorder.store.state.isRecording).toBe(false)
  })

  it('removes omitted cancel and clear callbacks', () => {
    const onCancel = vi.fn()
    const onClear = vi.fn()
    const onRecord = vi.fn()
    const recorder = create({ onRecord, onCancel, onClear })
    recorder.start()
    recorder.replaceOptions({ onRecord })
    press('Escape', 'Escape')
    expect(onCancel).not.toHaveBeenCalled()
    recorder.start()
    press('Backspace', 'Backspace')
    expect(onClear).not.toHaveBeenCalled()
    expect(onRecord).not.toHaveBeenCalled()
    expect(recorder.store.state.isRecording).toBe(false)
  })

  it('removes omitted validation and rejection callbacks', () => {
    const validate = vi.fn(() => false)
    const onReject = vi.fn()
    const onRecord = vi.fn()
    const recorder = create({ onRecord, validate, onReject, platform: 'linux' })
    recorder.start()
    recorder.replaceOptions({ onRecord, platform: 'linux' })
    press('s', '')
    expect(onReject).not.toHaveBeenCalled()
    expect(recorder.store.state.isRecording).toBe(true)
    press('s', 'KeyS')
    if (name === 'sequence') press('Enter', 'Enter')
    expect(validate).not.toHaveBeenCalled()
    expect(onRecord).toHaveBeenCalledExactlyOnceWith(name === 'sequence' ? ['[KeyS]'] : '[KeyS]')
  })
})

function sequenceRecorder(options: HotkeySequenceRecorderOptions): HotkeySequenceRecorder {
  const recorder = new HotkeySequenceRecorder(options)
  recorders.push(recorder)
  return recorder
}

describe('sequence recorder idle option updates', () => {
  it('reschedules a changed timeout from the patch without changing the steps', () => {
    vi.useFakeTimers()
    const onRecord = vi.fn()
    const recorder = sequenceRecorder({ onRecord, idleTimeoutMs: 100, platform: 'linux' })
    recorder.start()
    press('g', 'KeyG')
    vi.advanceTimersByTime(60)
    recorder.setOptions({ idleTimeoutMs: 200 })
    vi.advanceTimersByTime(40)
    expect(onRecord).not.toHaveBeenCalled()
    expect(recorder.store.state.steps).toEqual(['[KeyG]'])
    vi.advanceTimersByTime(159)
    expect(onRecord).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onRecord).toHaveBeenCalledExactlyOnceWith(['[KeyG]'])
  })

  it('cancels an existing idle deadline when replacement omits the timeout', () => {
    vi.useFakeTimers()
    const onRecord = vi.fn()
    const recorder = sequenceRecorder({ onRecord, idleTimeoutMs: 100, platform: 'linux' })
    recorder.start()
    press('g', 'KeyG')
    vi.advanceTimersByTime(40)
    recorder.replaceOptions({ onRecord, platform: 'linux' })
    vi.advanceTimersByTime(500)
    expect(onRecord).not.toHaveBeenCalled()
    expect(recorder.store.state.isRecording).toBe(true)
    expect(recorder.store.state.steps).toEqual(['[KeyG]'])
    recorder.commit()
    expect(onRecord).toHaveBeenCalledExactlyOnceWith(['[KeyG]'])
  })

  it('keeps the existing deadline when only the callback changes', () => {
    vi.useFakeTimers()
    const originalRecord = vi.fn()
    const latestRecord = vi.fn()
    const recorder = sequenceRecorder({ onRecord: originalRecord, idleTimeoutMs: 100 })
    recorder.start()
    press('g', 'KeyG')
    vi.advanceTimersByTime(60)
    recorder.replaceOptions({ onRecord: latestRecord, idleTimeoutMs: 100 })
    vi.advanceTimersByTime(39)
    expect(latestRecord).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(latestRecord).toHaveBeenCalledExactlyOnceWith(['[KeyG]'])
    expect(originalRecord).not.toHaveBeenCalled()
  })
})
