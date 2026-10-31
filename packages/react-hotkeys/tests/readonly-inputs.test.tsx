import { act, cleanup, renderHook } from '@testing-library/react'
import { formatHotkeySequence, getHotkeyRegistry } from '@fregat/hotkeys'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { useHotkeySequence } from '../src/useHotkeySequence.js'
import { useHotkeySequences } from '../src/useHotkeySequences.js'
import { useHotkeys } from '../src/useHotkeys.js'
import type { Hotkey, HotkeySequence } from '@fregat/hotkeys'
import type { ReactHotkeySequenceRecorder } from '../src/useHotkeySequenceRecorder.js'
import type { UseHotkeySequenceDefinition } from '../src/useHotkeySequences.js'
import type { UseHotkeyDefinition } from '../src/useHotkeys.js'

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
      useHotkeySequences(sequences)
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
    const sequence: HotkeySequence = ['G', 'G']
    const hotkeys: Array<UseHotkeyDefinition> = [{ hotkey: 'Escape', callback }]
    const sequences: Array<UseHotkeySequenceDefinition> = [{ sequence: ['D'], callback }]
    sequences[0]!.sequence.push('D')

    expectTypeOf<HotkeySequence>().toEqualTypeOf<Array<Hotkey>>()
    expectTypeOf<ReactHotkeySequenceRecorder['steps']>().toEqualTypeOf<Array<Hotkey>>()
    expectTypeOf<
      ReactHotkeySequenceRecorder['recordedSequence']
    >().toEqualTypeOf<Array<Hotkey> | null>()
    expect(formatHotkeySequence(sequence)).toBe('G G')

    renderHook(() => {
      useHotkeySequence(sequence, callback)
      useHotkeys(hotkeys)
      useHotkeySequences(sequences)
    })

    expect(getHotkeyRegistry().registrations.state.size).toBe(3)
  })
})
