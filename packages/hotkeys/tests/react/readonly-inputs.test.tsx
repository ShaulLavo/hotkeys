import { act, cleanup, renderHook } from '@testing-library/react'
import { formatHotkeySequence } from '../../src/format.js'
import { getHotkeyRegistry } from '../../src/index.js'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { useHotkeySequence } from '../../src/react/useHotkeySequence.js'
import { useHotkeys } from '../../src/react/useHotkeys.js'
import type { Hotkey, HotkeySequence } from '../../src/index.js'
import type { ReactHotkeySequenceRecorder } from '../../src/react/useHotkeySequenceRecorder.js'
import type { UseHotkeyDefinition } from '../../src/react/useHotkeys.js'

afterEach(() => {
  cleanup()
  getHotkeyRegistry().dispose()
})

function press(key: string): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}

describe('readonly registration inputs', () => {
  it('accepts nested const tuples for sequences and batch definitions', () => {
    const onSequence = vi.fn()
    const onHotkey = vi.fn()
    const onBatchSequence = vi.fn()
    const sequence = ['G', 'G'] as const
    const hotkeys = [{ hotkey: 'Escape', callback: onHotkey }] as const
    const sequences = [{ sequence: ['D', 'D'], callback: onBatchSequence }] as const

    expect(formatHotkeySequence(sequence)).toBe('G G')
    renderHook(() => {
      useHotkeySequence(sequence, onSequence)
      useHotkeys(hotkeys)
      useHotkeys(sequences)
    })

    press('g')
    press('g')
    press('Escape')
    press('d')
    press('d')

    expect(onSequence).toHaveBeenCalledTimes(1)
    expect(onHotkey).toHaveBeenCalledTimes(1)
    expect(onBatchSequence).toHaveBeenCalledTimes(1)
    expect(sequence).toEqual(['G', 'G'])
    expect(sequences[0].sequence).toEqual(['D', 'D'])
  })

  it('continues to accept mutable arrays and preserves mutable recorder outputs', () => {
    const callback = vi.fn()
    const sequence: Hotkey[] = ['G', 'G']
    const hotkeys: Array<UseHotkeyDefinition> = [{ hotkey: 'Escape', callback }]
    const mutableSequence: Hotkey[] = ['D']
    mutableSequence.push('D')
    const sequences: Array<UseHotkeyDefinition> = [{ sequence: mutableSequence, callback }]

    expectTypeOf<HotkeySequence>().toEqualTypeOf<readonly import('../../src').HotkeyStroke[]>()
    expectTypeOf<ReactHotkeySequenceRecorder['steps']>().toEqualTypeOf<Array<Hotkey>>()
    expectTypeOf<
      ReactHotkeySequenceRecorder['recordedSequence']
    >().toEqualTypeOf<Array<Hotkey> | null>()
    expect(formatHotkeySequence(sequence)).toBe('G G')

    renderHook(() => {
      useHotkeySequence(sequence, callback)
      useHotkeys(hotkeys)
      useHotkeys(sequences)
    })

    expect(getHotkeyRegistry().registrations.state.size).toBe(3)
  })
})
