import { act, cleanup, renderHook } from '@testing-library/react'
import { getHotkeyRegistry } from '@fregat/hotkeys'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  HotkeysProvider,
  useHotkey,
  useHotkeys,
  useHotkeySequence,
  useHotkeySequences,
} from '../src/index.js'
import type { Hotkey, HotkeyCallback, RegisterableHotkey } from '@fregat/hotkeys'
import type { ReactNode } from 'react'
import type { UseHotkeyOptions } from '../src/index.js'

type Fixture = {
  name: string
  sequence: boolean
  useRegistration: (key: Hotkey, callback: HotkeyCallback, options: UseHotkeyOptions) => void
}

function useSingle(key: Hotkey, callback: HotkeyCallback, options: UseHotkeyOptions) {
  useHotkey(key, callback, options)
}
function useSequence(key: Hotkey, callback: HotkeyCallback, options: UseHotkeyOptions) {
  useHotkeySequence([key, 'H'], callback, options)
}
function useBatch(key: Hotkey, callback: HotkeyCallback, options: UseHotkeyOptions) {
  useHotkeys([{ hotkey: key, callback, options }])
}
function useBatchSequence(key: Hotkey, callback: HotkeyCallback, options: UseHotkeyOptions) {
  useHotkeySequences([{ sequence: [key, 'H'], callback, options }])
}
const fixtures: readonly Fixture[] = [
  { name: 'useHotkey', sequence: false, useRegistration: useSingle },
  { name: 'useHotkeySequence', sequence: true, useRegistration: useSequence },
  { name: 'useHotkeys', sequence: false, useRegistration: useBatch },
  { name: 'useHotkeySequences', sequence: true, useRegistration: useBatchSequence },
]

beforeEach(() => getHotkeyRegistry().dispose())
afterEach(() => {
  cleanup()
  getHotkeyRegistry().dispose()
  document.body.replaceChildren()
})

function view() {
  const entries = Array.from(getHotkeyRegistry().registrations.state.values())
  expect(entries).toHaveLength(1)
  return entries[0]!
}
function dispatch(
  target: Document | HTMLElement,
  key: string,
  modifiers: KeyboardEventInit = {},
  type = 'keydown',
) {
  const event = new KeyboardEvent(
    type,
    Object.assign(
      {
        key,
        code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key,
        bubbles: true,
        cancelable: true,
      },
      modifiers,
    ),
  )
  act(() => target.dispatchEvent(event))
  return event
}
function press(
  fixture: Fixture,
  target: Document | HTMLElement,
  modifiers: KeyboardEventInit = {},
) {
  const first = dispatch(target, 'g', modifiers)
  dispatch(target, 'g', modifiers, 'keyup')
  if (!fixture.sequence) return first
  const last = dispatch(target, 'h')
  dispatch(target, 'h', {}, 'keyup')
  return last
}

test.each(fixtures)('$name removes omitted options without replacing its handle', (fixture) => {
  const callback = vi.fn()
  const initial: UseHotkeyOptions = {
    enabled: false,
    preventDefault: false,
    stopPropagation: false,
    requireReset: true,
    ignoreInputs: false,
    conflictBehavior: 'allow',
    meta: { name: 'old' },
  }
  const { rerender } = renderHook(
    ({ options }: { options: UseHotkeyOptions }) => fixture.useRegistration('G', callback, options),
    { initialProps: { options: initial } },
  )
  const id = view().id
  press(fixture, document)
  expect(callback).not.toHaveBeenCalled()
  rerender({ options: {} })
  const updated = view()
  expect(updated.id).toBe(id)
  expect(updated.options.enabled).not.toBe(false)
  expect(updated.options.preventDefault).not.toBe(false)
  expect(updated.options.stopPropagation).not.toBe(false)
  expect(updated.options.requireReset).not.toBe(true)
  expect(updated.options.ignoreInputs).toBe(true)
  expect(updated.options.conflictBehavior).not.toBe('allow')
  expect(updated.options.meta).toBeUndefined()
  expect(press(fixture, document).defaultPrevented).toBe(true)
  expect(callback).toHaveBeenCalledOnce()
})

test.each(fixtures.filter((fixture) => !fixture.sequence))(
  '$name restores keydown when eventType is omitted',
  (fixture) => {
    const callback = vi.fn()
    const { rerender } = renderHook(
      ({ options }: { options: UseHotkeyOptions }) =>
        fixture.useRegistration('G', callback, options),
      { initialProps: { options: { eventType: 'keyup' } as UseHotkeyOptions } },
    )
    const id = view().id
    dispatch(document, 'g')
    expect(callback).not.toHaveBeenCalled()
    dispatch(document, 'g', {}, 'keyup')
    expect(callback).toHaveBeenCalledOnce()
    rerender({ options: {} })
    expect(view().id).toBe(id)
    dispatch(document, 'g')
    expect(callback).toHaveBeenCalledTimes(2)
    dispatch(document, 'g', {}, 'keyup')
    expect(callback).toHaveBeenCalledTimes(2)
  },
)

for (const binding of ['G', 'Control+G'] as const) {
  test.each(fixtures)(
    `$name recomputes the input default for ${binding} after omission`,
    (fixture) => {
      const input = document.createElement('input')
      document.body.append(input)
      input.focus()
      const bare = binding === 'G'
      const callback = vi.fn()
      const { rerender } = renderHook(
        ({ options }: { options: UseHotkeyOptions }) =>
          fixture.useRegistration(binding, callback, options),
        { initialProps: { options: { ignoreInputs: !bare } as UseHotkeyOptions } },
      )
      const id = view().id
      press(fixture, input, { ctrlKey: !bare })
      expect(callback).toHaveBeenCalledTimes(bare ? 1 : 0)
      rerender({ options: {} })
      expect(view().id).toBe(id)
      expect(view().options.ignoreInputs).toBe(bare)
      press(fixture, input, { ctrlKey: !bare })
      expect(callback).toHaveBeenCalledOnce()
    },
  )
}

test.each(fixtures)(
  '$name falls back to current provider defaults and then core defaults',
  (fixture) => {
    let defaults: UseHotkeyOptions = { enabled: false, meta: { name: 'provider' } }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <HotkeysProvider defaultOptions={{ hotkey: defaults, hotkeySequence: defaults }}>
        {children}
      </HotkeysProvider>
    )
    const callback = vi.fn()
    const { rerender } = renderHook(
      ({ options }: { options: UseHotkeyOptions }) =>
        fixture.useRegistration('G', callback, options),
      {
        initialProps: { options: { enabled: true, meta: { name: 'local' } } as UseHotkeyOptions },
        wrapper,
      },
    )
    const id = view().id
    expect(view().options.meta?.name).toBe('local')
    press(fixture, document)
    expect(callback).toHaveBeenCalledOnce()
    rerender({ options: {} })
    expect(view().options.enabled).toBe(false)
    expect(view().options.meta?.name).toBe('provider')
    press(fixture, document)
    expect(callback).toHaveBeenCalledOnce()
    defaults = {}
    rerender({ options: {} })
    expect(view().id).toBe(id)
    expect(view().options.enabled).not.toBe(false)
    expect(view().options.meta).toBeUndefined()
    press(fixture, document)
    expect(callback).toHaveBeenCalledTimes(2)
  },
)

test.each(['single', 'sequence'] as const)(
  'batch %s options fall back through every precedence layer',
  (kind) => {
    let defaults: UseHotkeyOptions = { enabled: false, meta: { name: 'provider' } }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <HotkeysProvider defaultOptions={{ hotkey: defaults, hotkeySequence: defaults }}>
        {children}
      </HotkeysProvider>
    )
    const callback = vi.fn()
    function useRegistration({ row, common }: { row: UseHotkeyOptions; common: UseHotkeyOptions }) {
      useHotkeys(kind === 'single' ? [{ hotkey: 'G', callback, options: row }] : [], common)
      useHotkeySequences(
        kind === 'sequence' ? [{ sequence: ['G', 'H'], callback, options: row }] : [],
        common,
      )
    }
    const { rerender } = renderHook(useRegistration, {
      initialProps: {
        row: { enabled: false, meta: { name: 'row' } } as UseHotkeyOptions,
        common: { enabled: true, meta: { name: 'common' } } as UseHotkeyOptions,
      },
      wrapper,
    })
    const id = view().id
    expect(view().options.enabled).toBe(false)
    expect(view().options.meta?.name).toBe('row')
    rerender({ row: {}, common: { enabled: true, meta: { name: 'common' } } })
    expect(view().options.enabled).toBe(true)
    expect(view().options.meta?.name).toBe('common')
    rerender({ row: {}, common: {} })
    expect(view().options.enabled).toBe(false)
    expect(view().options.meta?.name).toBe('provider')
    defaults = {}
    rerender({ row: {}, common: {} })
    expect(view().id).toBe(id)
    expect(view().options.enabled).not.toBe(false)
    expect(view().options.meta).toBeUndefined()
  },
)

test.each(fixtures)('$name reparses Mod for a changed platform on the same handle', (fixture) => {
  const callback = vi.fn()
  const { rerender } = renderHook(
    ({ platform }: { platform: 'linux' | 'mac' }) =>
      fixture.useRegistration('Mod+G', callback, { platform }),
    { initialProps: { platform: 'linux' as 'linux' | 'mac' } },
  )
  const id = view().id
  press(fixture, document, { ctrlKey: true })
  expect(callback).toHaveBeenCalledOnce()
  rerender({ platform: 'mac' })
  expect(view().id).toBe(id)
  expect(view().strokes[0]).toMatchObject({ ctrl: false, meta: true })
  press(fixture, document, { ctrlKey: true })
  expect(callback).toHaveBeenCalledOnce()
  press(fixture, document, { metaKey: true })
  expect(callback).toHaveBeenCalledTimes(2)
})

test.each(fixtures)(
  '$name preserves changed symbolic intent before a platform update',
  (fixture) => {
    const callback = vi.fn()
    const { rerender } = renderHook(
      ({ binding, platform }: { binding: Hotkey; platform: 'linux' | 'mac' }) =>
        fixture.useRegistration(binding, callback, { platform }),
      { initialProps: { binding: 'Mod+G' as Hotkey, platform: 'linux' as 'linux' | 'mac' } },
    )
    const originalId = view().id
    rerender({ binding: 'Control+G', platform: 'linux' })
    const literalId = view().id
    expect(literalId).not.toBe(originalId)
    rerender({ binding: 'Control+G', platform: 'mac' })
    expect(view().id).toBe(literalId)
    expect(view().strokes[0]).toMatchObject({ ctrl: true, meta: false })
    press(fixture, document, { metaKey: true })
    expect(callback).not.toHaveBeenCalled()
    press(fixture, document, { ctrlKey: true })
    expect(callback).toHaveBeenCalledOnce()
  },
)

test.each(['single', 'batch'] as const)(
  '%s raw bindings preserve mod versus literal control intent',
  (kind) => {
    const callback = vi.fn()
    function useRegistration({
      binding,
      platform,
    }: {
      binding: RegisterableHotkey
      platform: 'linux' | 'mac'
    }) {
      useHotkey(kind === 'single' ? binding : 'F12', callback, {
        platform,
        enabled: kind === 'single',
      })
      useHotkeys(kind === 'batch' ? [{ hotkey: binding, callback }] : [], { platform })
    }
    const { rerender } = renderHook(useRegistration, {
      initialProps: {
        binding: { key: 'G', mod: true } as RegisterableHotkey,
        platform: 'linux' as 'linux' | 'mac',
      },
    })
    function activeView() {
      return Array.from(getHotkeyRegistry().registrations.state.values()).find(
        (entry) => entry.options.enabled !== false,
      )!
    }
    const firstId = activeView().id
    rerender({ binding: { key: 'G', ctrl: true }, platform: 'linux' })
    const literalId = activeView().id
    expect(literalId).not.toBe(firstId)
    rerender({ binding: { ctrl: true, key: 'G' }, platform: 'mac' })
    expect(activeView().id).toBe(literalId)
    expect(activeView().strokes[0]).toMatchObject({ ctrl: true, meta: false })
    dispatch(document, 'g', { metaKey: true })
    expect(callback).not.toHaveBeenCalled()
    dispatch(document, 'g', { ctrlKey: true })
    expect(callback).toHaveBeenCalledOnce()
  },
)

test.each(fixtures)(
  '$name moves a live target ref and resets an omitted target on the same handle',
  (fixture) => {
    const first = document.createElement('div')
    const second = document.createElement('div')
    document.body.append(first, second)
    const target = { current: first as HTMLElement | null }
    const callback = vi.fn()
    const { rerender } = renderHook(
      ({ options }: { options: UseHotkeyOptions }) =>
        fixture.useRegistration('G', callback, options),
      { initialProps: { options: { target } as UseHotkeyOptions } },
    )
    const id = view().id
    press(fixture, first)
    press(fixture, second)
    expect(callback).toHaveBeenCalledOnce()
    target.current = second
    rerender({ options: { target } })
    expect(view().id).toBe(id)
    expect(view().target).toBe(second)
    press(fixture, first)
    press(fixture, second)
    expect(callback).toHaveBeenCalledTimes(2)
    rerender({ options: {} })
    expect(view().id).toBe(id)
    expect(view().target).toBe(document)
    press(fixture, first)
    press(fixture, second)
    expect(callback).toHaveBeenCalledTimes(4)
  },
)
