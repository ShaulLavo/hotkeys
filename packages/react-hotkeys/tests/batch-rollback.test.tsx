import { Component } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { getHotkeyRegistry, parseHotkey } from '@fregat/hotkeys'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHotkeys } from '../src/useHotkeys.js'
import { useHotkeySequences } from '../src/useHotkeySequences.js'
import type { ReactNode } from 'react'
import type { Hotkey, HotkeyCallback, HotkeyRegistry } from '@fregat/hotkeys'
import type { UseHotkeyOptions } from '../src/useHotkey.js'

type Row = {
  keys: readonly Hotkey[]
  callback: HotkeyCallback
  options?: UseHotkeyOptions
}

class FailureBoundary extends Component<
  { children: ReactNode; onError: (error: unknown) => void },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    this.props.onError(error)
  }

  render() {
    return this.state.failed ? <output>failed</output> : this.props.children
  }
}

let registry: HotkeyRegistry

beforeEach(() => {
  getHotkeyRegistry().dispose()
  registry = getHotkeyRegistry()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  registry.dispose()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function dispatch(keys: readonly Hotkey[], target: Document | HTMLElement = document): void {
  act(() => {
    for (const hotkey of keys) {
      const parsed = parseHotkey(hotkey, 'linux')
      const key = parsed.key ?? ''
      const code = parsed.code ?? (/^[A-Z]$/.test(key) ? `Key${key}` : key)
      const options = {
        key,
        code,
        ctrlKey: parsed.ctrl,
        altKey: parsed.alt,
        metaKey: parsed.meta,
        shiftKey: parsed.shift,
        bubbles: true,
        cancelable: true,
      }
      target.dispatchEvent(new KeyboardEvent('keydown', options))
      target.dispatchEvent(new KeyboardEvent('keyup', options))
    }
  })
}

const fixtures = [
  {
    name: 'useHotkeys',
    keys: (key: Hotkey): readonly Hotkey[] => [key],
    useBatch: (rows: readonly Row[]) =>
      useHotkeys(
        rows.map((row) => ({
          hotkey: row.keys[0]!,
          callback: row.callback,
          options: row.options,
        })),
      ),
  },
  {
    name: 'useHotkeySequences',
    keys: (key: Hotkey): readonly Hotkey[] => [key, key],
    useBatch: (rows: readonly Row[]) =>
      useHotkeySequences(
        rows.map((row) => ({
          sequence: row.keys,
          callback: row.callback,
          options: row.options,
        })),
      ),
  },
]

describe.each(fixtures)('$name failure cleanup', ({ keys, useBatch }) => {
  function row(key: Hotkey, callback: HotkeyCallback, options?: UseHotkeyOptions): Row {
    return { keys: keys(key), callback, options }
  }

  function Batch({ rows }: { rows: readonly Row[] }) {
    useBatch(rows)
    return <output>ready</output>
  }

  function mount(rows: readonly Row[]) {
    const errors: unknown[] = []
    const tree = (definitions: readonly Row[], revision = 0) => (
      <FailureBoundary key={revision} onError={(error) => errors.push(error)}>
        <Batch rows={definitions} />
      </FailureBoundary>
    )
    const view = render(tree(rows))
    return {
      errors,
      view,
      update: (definitions: readonly Row[], revision = 0) =>
        view.rerender(tree(definitions, revision)),
    }
  }

  it('releases a partially acquired first mount and recovers on a boundary remount', () => {
    const externalCallback = vi.fn()
    const external = registry.register(keys('F12'), externalCallback)
    const callback = vi.fn()
    const mounted = mount([
      row('F9', callback),
      row('F12', callback, { conflictBehavior: 'error' }),
    ])
    expect(mounted.view.getByText('failed')).toBeTruthy()
    expect(mounted.errors).toHaveLength(1)
    expect(mounted.errors[0]).toBeInstanceOf(Error)
    expect(Array.from(registry.registrations.state.keys())).toEqual([external.id])
    dispatch(keys('F9'))
    expect(callback).not.toHaveBeenCalled()
    dispatch(keys('F12'))
    expect(externalCallback).toHaveBeenCalledOnce()

    mounted.update([row('F9', callback), row('F10', callback)], 1)
    expect(mounted.view.getByText('ready')).toBeTruthy()
    expect(registry.registrations.state.size).toBe(3)
    dispatch(keys('F9'))
    dispatch(keys('F10'))
    expect(callback).toHaveBeenCalledTimes(2)
    mounted.view.unmount()
    expect(Array.from(registry.registrations.state.keys())).toEqual([external.id])
    dispatch(keys('F9'))
    dispatch(keys('F10'))
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('releases retained, removed, and newly acquired rows when a later update conflicts', () => {
    const external = registry.register(keys('F12'), vi.fn())
    const original = vi.fn()
    const latest = vi.fn()
    const mounted = mount([row('F9', original), row('F10', original)])
    dispatch(keys('F9'))
    expect(original).toHaveBeenCalledOnce()
    mounted.update([
      row('F9', latest),
      row('F11', latest),
      row('F12', latest, { conflictBehavior: 'error' }),
    ])
    expect(mounted.errors).toHaveLength(1)
    expect(Array.from(registry.registrations.state.keys())).toEqual([external.id])
    for (const key of ['F9', 'F10', 'F11'] as const) dispatch(keys(key))
    expect(original).toHaveBeenCalledOnce()
    expect(latest).not.toHaveBeenCalled()
  })

  it.each(['target', 'platform'] as const)(
    'releases the whole batch after an existing row has a %s update conflict',
    (change) => {
      const left = document.createElement('div')
      const right = document.createElement('div')
      document.body.append(left, right)
      const callback = vi.fn()
      const externalCallback = vi.fn()
      const initial =
        change === 'target'
          ? row('F9', callback, { target: left, conflictBehavior: 'error' })
          : row('Mod+G', callback, { platform: 'linux', conflictBehavior: 'error' })
      const external = registry.register(
        keys(change === 'target' ? 'F9' : 'Meta+G'),
        externalCallback,
        change === 'target' ? { target: right } : { platform: 'linux' },
      )
      const mounted = mount([row('F10', callback), initial])
      mounted.update([
        row('F10', callback),
        change === 'target'
          ? row('F9', callback, { target: right, conflictBehavior: 'error' })
          : row('Mod+G', callback, { platform: 'mac', conflictBehavior: 'error' }),
      ])
      expect(mounted.errors).toHaveLength(1)
      expect(Array.from(registry.registrations.state.keys())).toEqual([external.id])
      dispatch(keys('F10'))
      dispatch(keys(change === 'target' ? 'F9' : 'Control+G'), left)
      expect(callback).not.toHaveBeenCalled()
      dispatch(keys(change === 'target' ? 'F9' : 'Meta+G'), right)
      expect(externalCallback).toHaveBeenCalledOnce()
    },
  )

  it('preserves a planning error while attempting every old-handle release', () => {
    const external = registry.register(keys('F12'), vi.fn())
    const callback = vi.fn()
    const mounted = mount([row('F9', callback), row('F10', callback)])
    const planningError = new Error('target ref resolution failed')
    const cleanupError = new Error('cleanup subscriber failed')
    const releases: number[] = []
    const subscription = registry.registrations.subscribe(() => {
      releases.push(registry.registrations.state.size)
      throw cleanupError
    })
    try {
      mounted.update([
        row('F9', callback),
        row('F10', callback, {
          target: {
            get current(): HTMLElement | null {
              throw planningError
            },
          },
        }),
      ])
    } finally {
      subscription.unsubscribe()
    }
    expect(mounted.errors).toHaveLength(1)
    expect(mounted.errors[0]).toBe(planningError)
    expect(releases).toEqual([2, 1])
    expect(Array.from(registry.registrations.state.keys())).toEqual([external.id])
    dispatch(keys('F9'))
    dispatch(keys('F10'))
    expect(callback).not.toHaveBeenCalled()
  })

  it('does not restore an external replace victim when a later row fails', () => {
    const victimCallback = vi.fn()
    const victim = registry.register(keys('F9'), victimCallback)
    const survivorCallback = vi.fn()
    const survivor = registry.register(keys('F12'), survivorCallback)
    const callback = vi.fn()
    const mounted = mount([
      row('F9', callback, { conflictBehavior: 'replace' }),
      row('F12', callback, { conflictBehavior: 'error' }),
    ])
    expect(mounted.errors).toHaveLength(1)
    expect(victim.isActive).toBe(false)
    expect(survivor.isActive).toBe(true)
    expect(Array.from(registry.registrations.state.keys())).toEqual([survivor.id])
    dispatch(keys('F9'))
    expect(victimCallback).not.toHaveBeenCalled()
    expect(callback).not.toHaveBeenCalled()
    dispatch(keys('F12'))
    expect(survivorCallback).toHaveBeenCalledOnce()
  })

  it('preserves a publication error and cleans returned and unreturned registrations', () => {
    const externalCallback = vi.fn()
    const external = registry.register(keys('F12'), externalCallback)
    const callback = vi.fn()
    const publicationError = new Error('registration subscriber failed')
    const cleanupError = new Error('cleanup subscriber failed')
    let failed = false
    const cleanupSizes: number[] = []
    const subscription = registry.registrations.subscribe(() => {
      const size = registry.registrations.state.size
      if (!failed && size === 4) {
        failed = true
        throw publicationError
      }
      if (failed) {
        cleanupSizes.push(size)
        throw cleanupError
      }
    })
    let mounted: ReturnType<typeof mount>
    try {
      mounted = mount([row('F9', callback), row('F10', callback), row('F11', callback)])
    } finally {
      subscription.unsubscribe()
    }
    expect(mounted.errors).toHaveLength(1)
    expect(mounted.errors[0]).toBe(publicationError)
    expect(cleanupSizes).toEqual([3, 2, 1])
    expect(Array.from(registry.registrations.state.keys())).toEqual([external.id])
    expect(external.isActive).toBe(true)
    for (const key of ['F9', 'F10', 'F11'] as const) dispatch(keys(key))
    expect(callback).not.toHaveBeenCalled()
    dispatch(keys('F12'))
    expect(externalCallback).toHaveBeenCalledOnce()
  })

  it('attempts all unmount releases and surfaces the first cleanup error', () => {
    const external = registry.register(keys('F12'), vi.fn())
    const callback = vi.fn()
    const view = render(<Batch rows={[row('F9', callback), row('F10', callback)]} />)
    const firstError = new Error('first unsubscribe publication failed')
    const secondError = new Error('second unsubscribe publication failed')
    const sizes: number[] = []
    const subscription = registry.registrations.subscribe(() => {
      sizes.push(registry.registrations.state.size)
      throw sizes.length === 1 ? firstError : secondError
    })
    let caught: unknown
    try {
      view.unmount()
    } catch (error) {
      caught = error
    } finally {
      subscription.unsubscribe()
    }
    expect(caught).toBe(firstError)
    expect(sizes).toEqual([2, 1])
    expect(Array.from(registry.registrations.state.keys())).toEqual([external.id])
    dispatch(keys('F9'))
    dispatch(keys('F10'))
    expect(callback).not.toHaveBeenCalled()
  })

  it('reacquires once under StrictMode and leaves no callbacks after unmount', () => {
    const external = registry.register(keys('F12'), vi.fn())
    const callback = vi.fn()
    const view = render(<Batch rows={[row('F9', callback), row('F10', callback)]} />, {
      reactStrictMode: true,
    })
    expect(registry.registrations.state.size).toBe(3)
    dispatch(keys('F9'))
    dispatch(keys('F10'))
    expect(callback).toHaveBeenCalledTimes(2)
    view.unmount()
    expect(Array.from(registry.registrations.state.keys())).toEqual([external.id])
    dispatch(keys('F9'))
    dispatch(keys('F10'))
    expect(callback).toHaveBeenCalledTimes(2)
  })
})
