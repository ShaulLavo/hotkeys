import { afterEach, expect, test } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { getHotkeyRegistry } from '@fregat/hotkeys'
import { useHotkey, useHotkeys, useHotkeySequence, useHotkeySequences } from '../src/index.js'

afterEach(() => {
  cleanup()
  getHotkeyRegistry().dispose()
})

function key(init: KeyboardEventInit) {
  const event = new KeyboardEvent(
    'keydown',
    Object.assign({ bubbles: true, cancelable: true }, init),
  )
  document.dispatchEvent(event)
  return event
}

test('single and batch hooks share shifted-glyph matching for shortcuts and sequences', () => {
  const received: Array<{ name: string; event: KeyboardEvent }> = []
  renderHook(() => {
    useHotkey('?', (event) => void received.push({ name: 'single', event }), { platform: 'linux' })
    useHotkeys(
      [
        {
          hotkey: { key: '+', ctrl: true },
          callback: (event) => void received.push({ name: 'batch', event }),
        },
      ],
      { platform: 'linux' },
    )
    useHotkeySequence(['G', '?'], (event) => void received.push({ name: 'sequence', event }), {
      platform: 'linux',
    })
    useHotkeySequences(
      [
        {
          sequence: ['H', 'Control++'],
          callback: (event) => void received.push({ name: 'batch sequence', event }),
        },
      ],
      { platform: 'linux' },
    )
  })
  const triggering: KeyboardEvent[] = []
  act(() => {
    triggering.push(key({ key: '?', code: 'Slash', shiftKey: true }))
    triggering.push(key({ key: '+', code: 'Equal', ctrlKey: true, shiftKey: true }))
    key({ key: 'g', code: 'KeyG' })
    triggering.push(key({ key: '?', code: 'Slash', shiftKey: true }))
    key({ key: 'h', code: 'KeyH' })
    triggering.push(key({ key: '+', code: 'Equal', ctrlKey: true, shiftKey: true }))
  })

  expect(received.map((call) => call.name)).toEqual([
    'single',
    'batch',
    'sequence',
    'batch sequence',
  ])
  for (const [index, event] of triggering.entries()) {
    expect(event.defaultPrevented).toBe(true)
    expect(received[index]?.event).toBe(event)
  }
})
