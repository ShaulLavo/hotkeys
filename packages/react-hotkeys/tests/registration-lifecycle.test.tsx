// @vitest-environment happy-dom
import { Suspense, useRef } from 'react'
import { renderToString } from 'react-dom/server'
import { act, cleanup, render } from '@testing-library/react'
import { getHotkeyRegistry, getKeyStateTracker, KeyStateTracker } from '@fregat/hotkeys'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import type { UseHotkeyOptions } from '../src/useHotkey.js'
import type { MockInstance } from 'vitest'

beforeEach(() => {
  getHotkeyRegistry().dispose()
  KeyStateTracker.resetInstance()
})

afterEach(() => {
  cleanup()
  getHotkeyRegistry().dispose()
  KeyStateTracker.resetInstance()
  vi.restoreAllMocks()
})

function useFixtureRegistrations(
  onCommand: (name: string) => void,
  options: UseHotkeyOptions = {},
) {
  useHotkey('F9', () => onCommand('single'), options)
  useHotkeySequence(['G', 'G'], () => onCommand('sequence'), options)
  useHotkeys([{ hotkey: 'F10', callback: () => onCommand('batch-single') }], options)
  useHotkeySequences(
    [{ sequence: ['D', 'D'], callback: () => onCommand('batch-sequence') }],
    options,
  )
}

function useKeyboardSummary(): string {
  const { hotkeys, sequences } = useHotkeyRegistrations()
  const heldKeys = useHeldKeys()
  const heldCodes = useHeldKeyCodes()
  const shift = useKeyHold('Shift')
  const hint = useHotkeyHint('Shift+S')
  return `${hotkeys.length}:${sequences.length}|${heldKeys.join(',')}|${Object.values(heldCodes).join(',')}|${shift}|${hint}`
}

function KeyboardView({ onCommand }: { onCommand: (name: string) => void }) {
  useFixtureRegistrations(onCommand)
  const summary = useKeyboardSummary()
  useHotkeyRecorder({ onRecord: () => {} })
  useHotkeySequenceRecorder({ onRecord: () => {} })
  return <output>{summary}</output>
}

function press(target: Document | HTMLElement, key: string): void {
  const code = key.length === 1 ? `Key${key.toUpperCase()}` : key
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }),
    )
    target.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true, cancelable: true }))
  })
}

function pressBindings(target: Document | HTMLElement): void {
  for (const key of ['F9', 'F10', 'g', 'g', 'd', 'd']) press(target, key)
}

describe('render and commit boundaries', () => {
  it('releases held state when a child registration consumes the shortcut', () => {
    const onCommand = vi.fn()
    function Shortcut() {
      useHotkey('F9', onCommand)
      return null
    }
    function HeldParent() {
      const heldKeys = useHeldKeys()
      return (
        <>
          <Shortcut />
          <output>{heldKeys.join(',')}</output>
        </>
      )
    }

    const view = render(<HeldParent />)
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9', code: 'F9', bubbles: true }))
    })
    expect(onCommand).toHaveBeenCalledTimes(1)
    expect(view.container.textContent).toBe('F9')

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'F9', code: 'F9', bubbles: true }))
    })
    expect(view.container.textContent).toBe('')
  })

  it('does not attach keyboard listeners during server rendering in a browser environment', () => {
    const documentListeners = vi.spyOn(document, 'addEventListener')
    const windowListeners = vi.spyOn(window, 'addEventListener')
    const onCommand = vi.fn()

    expect(renderToString(<KeyboardView onCommand={onCommand} />)).toBe(
      '<output>0:0|||false|false</output>',
    )

    expect(
      documentListeners.mock.calls.filter(([type]) => type === 'keydown' || type === 'keyup'),
    ).toEqual([])
    expect(
      windowListeners.mock.calls.filter(([type]) => type === 'keydown' || type === 'keyup'),
    ).toEqual([])
    expect(onCommand).not.toHaveBeenCalled()
  })

  it('does not acquire keyboard listeners for an abandoned suspended render', () => {
    const documentListeners = vi.spyOn(document, 'addEventListener')
    const windowListeners = vi.spyOn(window, 'addEventListener')
    const pending = new Promise<never>(() => {})
    const attempted = vi.fn()
    const onCommand = vi.fn()
    function PendingView(): never {
      useFixtureRegistrations(onCommand)
      useKeyboardSummary()
      attempted()
      throw pending
    }

    const view = render(
      <Suspense fallback={<p>Waiting</p>}>
        <PendingView />
      </Suspense>,
    )
    expect(view.getByText('Waiting')).toBeTruthy()
    expect(attempted).toHaveBeenCalled()
    view.rerender(<p>Replaced</p>)

    expect(
      documentListeners.mock.calls.filter(([type]) => type === 'keydown' || type === 'keyup'),
    ).toEqual([])
    expect(
      windowListeners.mock.calls.filter(([type]) => type === 'keydown' || type === 'keyup'),
    ).toEqual([])
    expect(onCommand).not.toHaveBeenCalled()
  })

  it('hydrates an empty server snapshot before observing existing live state and registering once', () => {
    const registry = getHotkeyRegistry()
    const externalCallback = vi.fn()
    const external = registry.register('F8', externalCallback)
    const tracker = getKeyStateTracker()
    const unsubscriptions: Array<MockInstance<() => void>> = []
    const subscribeRegistrations = registry.registrations.subscribe.bind(registry.registrations)
    const subscribeHeldState = tracker.store.subscribe.bind(tracker.store)
    const registrySubscriptions = vi
      .spyOn(registry.registrations, 'subscribe')
      .mockImplementation((listener) => {
        const subscription = subscribeRegistrations(listener)
        unsubscriptions.push(vi.spyOn(subscription, 'unsubscribe'))
        return subscription
      })
    const heldSubscriptions = vi
      .spyOn(tracker.store, 'subscribe')
      .mockImplementation((listener) => {
        const subscription = subscribeHeldState(listener)
        unsubscriptions.push(vi.spyOn(subscription, 'unsubscribe'))
        return subscription
      })
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Shift',
        code: 'ShiftLeft',
        shiftKey: true,
        bubbles: true,
      }),
    )
    const onCommand = vi.fn()
    const onRecoverableError = vi.fn()
    const container = document.createElement('div')
    container.innerHTML = renderToString(<KeyboardView onCommand={onCommand} />)
    document.body.append(container)
    expect(container.textContent).toBe('0:0|||false|false')

    const view = render(<KeyboardView onCommand={onCommand} />, {
      container,
      hydrate: true,
      onRecoverableError,
    })

    expect(onRecoverableError).not.toHaveBeenCalled()
    expect(registrySubscriptions).toHaveBeenCalled()
    expect(heldSubscriptions).toHaveBeenCalled()
    expect(container.textContent).toBe('3:2|Shift|ShiftLeft|true|true')
    expect(Array.from(registry.registrations.state.values(), (entry) => entry.hotkey)).toEqual([
      'F8',
      'F9',
      'G G',
      'F10',
      'D D',
    ])

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'Shift', code: 'ShiftLeft', bubbles: true }),
      )
    })
    expect(container.textContent).toBe('3:2|||false|false')
    pressBindings(document)
    expect(onCommand.mock.calls.map(([name]) => name)).toEqual([
      'single',
      'batch-single',
      'sequence',
      'batch-sequence',
    ])

    view.unmount()
    for (const unsubscribe of unsubscriptions) expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(Array.from(registry.registrations.state.keys())).toEqual([external.id])
    pressBindings(document)
    expect(onCommand).toHaveBeenCalledTimes(4)
    press(document, 'F8')
    expect(externalCallback).toHaveBeenCalledTimes(1)
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftRight', bubbles: true }),
    )
    expect(tracker.getHeldKeys()).toEqual(['Shift'])
    external.unregister()
  })

  it('keeps committed callbacks, enabled state and attached refs correct through StrictMode cleanup', () => {
    function ScopedBindings({
      onCommand,
      enabled,
      mounted,
      second,
    }: {
      onCommand: (name: string) => void
      enabled: boolean
      mounted: boolean
      second: boolean
    }) {
      const firstTarget = useRef<HTMLDivElement>(null)
      const secondTarget = useRef<HTMLDivElement>(null)
      useFixtureRegistrations(onCommand, {
        enabled,
        target: second ? secondTarget : firstTarget,
      })
      const { hotkeys, sequences } = useHotkeyRegistrations()
      return (
        <section>
          {mounted && <div ref={firstTarget} data-testid='first' />}
          {mounted && <div ref={secondTarget} data-testid='second' />}
          <output>{`${hotkeys.length}:${sequences.length}`}</output>
        </section>
      )
    }

    const initialCallback = vi.fn()
    const currentCallback = vi.fn()
    const view = render(
      <ScopedBindings onCommand={initialCallback} enabled mounted second={false} />,
      { reactStrictMode: true },
    )
    const registry = getHotkeyRegistry()
    expect(registry.registrations.state.size).toBe(4)

    view.rerender(
      <ScopedBindings onCommand={initialCallback} enabled mounted={false} second={false} />,
    )
    expect(registry.registrations.state.size).toBe(0)

    view.rerender(<ScopedBindings onCommand={initialCallback} enabled mounted second={false} />)
    expect(registry.registrations.state.size).toBe(4)
    const ids = Array.from(registry.registrations.state.keys())
    const first = view.getByTestId('first')
    const second = view.getByTestId('second')
    pressBindings(first)
    expect(initialCallback).toHaveBeenCalledTimes(4)
    pressBindings(second)
    expect(initialCallback).toHaveBeenCalledTimes(4)

    view.rerender(
      <ScopedBindings onCommand={currentCallback} enabled={false} mounted second={false} />,
    )
    expect(Array.from(registry.registrations.state.keys())).toEqual(ids)
    pressBindings(first)
    expect(currentCallback).not.toHaveBeenCalled()

    view.rerender(<ScopedBindings onCommand={currentCallback} enabled mounted second={false} />)
    expect(Array.from(registry.registrations.state.keys())).toEqual(ids)
    pressBindings(first)
    expect(currentCallback).toHaveBeenCalledTimes(4)
    expect(initialCallback).toHaveBeenCalledTimes(4)

    view.rerender(<ScopedBindings onCommand={currentCallback} enabled mounted second />)
    expect(registry.registrations.state.size).toBe(4)
    expect(
      Array.from(registry.registrations.state.values()).every((entry) => entry.target === second),
    ).toBe(true)
    pressBindings(first)
    expect(currentCallback).toHaveBeenCalledTimes(4)
    pressBindings(second)
    expect(currentCallback).toHaveBeenCalledTimes(8)

    view.unmount()
    expect(registry.registrations.state.size).toBe(0)
    pressBindings(document)
    expect(currentCallback).toHaveBeenCalledTimes(8)
  })
})
