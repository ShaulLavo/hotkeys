// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { KeyStateTracker } from '@fregat/hotkeys'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useHotkey } from '../src/useHotkey.js'
import { useHotkeySequence } from '../src/useHotkeySequence.js'
import { useHotkeys } from '../src/useHotkeys.js'
import { useHotkeySequences } from '../src/useHotkeySequences.js'
import { useHotkeyRegistrations } from '../src/useHotkeyRegistrations.js'
import { useHeldKeys } from '../src/useHeldKeys.js'
import { useHeldKeyCodes } from '../src/useHeldKeyCodes.js'
import { useKeyHold } from '../src/useKeyHold.js'
import { useHotkeyHint } from '../src/useHotkeyHint.js'
import { useHotkeyRecorder } from '../src/useHotkeyRecorder.js'
import { useHotkeySequenceRecorder } from '../src/useHotkeySequenceRecorder.js'

afterEach(() => {
  vi.restoreAllMocks()
})

const registrationComponents = [
  {
    name: 'useHotkey',
    Component: function SingleHotkey() {
      useHotkey('Mod+S', () => {})
      return null
    },
  },
  {
    name: 'useHotkeySequence',
    Component: function SingleSequence() {
      useHotkeySequence(['G', 'G'], () => {})
      return null
    },
  },
  {
    name: 'useHotkeys',
    Component: function BatchHotkeys() {
      useHotkeys([{ hotkey: 'Escape', callback: () => {} }])
      return null
    },
  },
  {
    name: 'useHotkeySequences',
    Component: function BatchSequences() {
      useHotkeySequences([{ sequence: ['D', 'D'], callback: () => {} }])
      return null
    },
  },
]

describe('server rendering without browser globals', () => {
  it.each(registrationComponents)('$name renders without acquiring a document', ({ Component }) => {
    expect(typeof window).toBe('undefined')
    expect(typeof document).toBe('undefined')

    expect(renderToString(createElement(Component))).toBe('')
  })

  it('useHotkeyRegistrations provides a repeatable empty server snapshot', () => {
    function Registrations() {
      const { hotkeys, sequences } = useHotkeyRegistrations()
      return <output>{`${hotkeys.length}:${sequences.length}`}</output>
    }

    expect(typeof window).toBe('undefined')
    expect(typeof document).toBe('undefined')
    expect(renderToString(<Registrations />)).toBe('<output>0:0</output>')
    expect(renderToString(<Registrations />)).toBe('<output>0:0</output>')
  })

  it('held-key and hint hooks provide empty server snapshots', () => {
    const getTracker = vi.spyOn(KeyStateTracker, 'getInstance')
    function HeldState() {
      const keys = useHeldKeys()
      const codes = useHeldKeyCodes()
      const shift = useKeyHold('Shift')
      const hint = useHotkeyHint('Shift+S')
      return <output>{`${keys.length}:${Object.keys(codes).length}:${shift}:${hint}`}</output>
    }

    expect(renderToString(<HeldState />)).toBe('<output>0:0:false:false</output>')
    expect(renderToString(<HeldState />)).toBe('<output>0:0:false:false</output>')
    expect(getTracker).not.toHaveBeenCalled()
  })

  it('recorder hooks render idle snapshots without invoking callbacks', () => {
    const onRecord = vi.fn()
    function Recorders() {
      const single = useHotkeyRecorder({ onRecord })
      const sequence = useHotkeySequenceRecorder({ onRecord })
      return (
        <output>
          {`${single.isRecording}:${single.recordedHotkey}:${sequence.isRecording}:${sequence.steps.length}:${sequence.recordedSequence}`}
        </output>
      )
    }

    expect(renderToString(<Recorders />)).toBe('<output>false:null:false:0:null</output>')
    expect(onRecord).not.toHaveBeenCalled()
  })
})
