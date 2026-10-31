import { afterEach, expect, test, vi } from 'vitest'
import {
  bindingsForInput,
  compileKeymap,
  createBrowserDispatcher,
  createHotkeyRegistry,
  keyInputFromKeyboardEvent,
  matchesKeyboardEvent,
} from '../../src/index.js'
import type {
  BrowserDispatcher,
  HotkeyKeys,
  HotkeyRegistry,
  KeymapEntry,
  RegisterableHotkey,
} from '../../src/index.js'

let dispatcher: BrowserDispatcher | undefined
let registry: HotkeyRegistry | undefined
afterEach(() => {
  dispatcher?.dispose()
  dispatcher = undefined
  registry?.dispose()
  registry = undefined
})

function key(init: KeyboardEventInit, type = 'keydown', altGraph = false) {
  const event = new KeyboardEvent(
    type,
    Object.assign({ bubbles: true, cancelable: true, composed: true }, init),
  )
  if (altGraph) {
    Object.defineProperty(event, 'getModifierState', {
      value: (modifier: string) => modifier === 'AltGraph',
    })
  }
  document.dispatchEvent(event)
  return event
}

const printedCases: ReadonlyArray<{
  name: string
  keys: KeymapEntry['keys']
  event: KeyboardEventInit
}> = [
  { name: 'question mark', keys: '?', event: { key: '?', code: 'Slash', shiftKey: true } },
  {
    name: 'question mark at another layout position',
    keys: '?',
    event: { key: '?', code: 'Comma', shiftKey: true },
  },
  {
    name: 'Control plus',
    keys: 'Control++',
    event: { key: '+', code: 'Equal', ctrlKey: true, shiftKey: true },
  },
  {
    name: 'unshifted numpad plus',
    keys: 'Control++',
    event: { key: '+', code: 'NumpadAdd', ctrlKey: true },
  },
  {
    name: 'raw question mark',
    keys: [{ key: '?', ctrl: true }],
    event: { key: '?', code: 'Slash', ctrlKey: true, shiftKey: true },
  },
]

test.each(printedCases)(
  'dispatches a printed $name without adding Shift to the binding',
  ({ keys, event }) => {
    const callback = vi.fn()
    dispatcher = createBrowserDispatcher({
      platform: 'linux',
      keymap: [{ keys, command: 'run' }],
    })
    dispatcher.createNode({ commands: { run: callback } }).focus()

    const source = key(event)

    expect(callback).toHaveBeenCalledOnce()
    expect(callback.mock.calls[0]?.[0].source).toBe(source)
    expect(callback.mock.calls[0]).toEqual([
      expect.objectContaining({
        input: expect.objectContaining({
          key: event.key,
          modifiers: expect.objectContaining({
            shift: event.shiftKey ?? false,
            ctrl: event.ctrlKey ?? false,
          }),
        }),
      }),
    ])
    expect(source.defaultPrevented).toBe(true)
  },
)

test.each([
  {
    keys: '? G',
    events: [
      { key: '?', code: 'Slash', shiftKey: true },
      { key: 'g', code: 'KeyG' },
    ],
  },
  {
    keys: 'G ?',
    events: [
      { key: 'g', code: 'KeyG' },
      { key: '?', code: 'Slash', shiftKey: true },
    ],
  },
])('matches shifted punctuation inside the $keys sequence', ({ keys, events }) => {
  const callback = vi.fn()
  const entries: KeymapEntry[] = [{ keys, command: 'run' }]
  const compiled = compileKeymap(entries, 'linux')
  dispatcher = createBrowserDispatcher({ platform: 'linux', keymap: entries })
  dispatcher.createNode({ commands: { run: callback } }).focus()
  const prefix = key(events[0]!)
  expect(prefix.defaultPrevented).toBe(true)
  const prefixInput = keyInputFromKeyboardEvent(prefix, 'linux')
  expect(bindingsForInput(compiled, [prefixInput], [])).toEqual({ bindings: [], pending: true })
  expect(callback).not.toHaveBeenCalled()
  const completion = key(events[1]!)
  const complete = bindingsForInput(
    compiled,
    [prefixInput, keyInputFromKeyboardEvent(completion, 'linux')],
    [],
  )
  expect(complete.pending).toBe(false)
  expect(complete.bindings.map((binding) => binding.command)).toEqual(['run'])
  expect(completion.defaultPrevented).toBe(true)
  expect(callback).toHaveBeenCalledOnce()
  expect(callback.mock.calls[0]?.[0].source).toBe(completion)
  expect(dispatcher.pending()).toBeNull()
})

test.each([
  { keys: ['Shift+?', 'Shift+[Slash]', '?', 'Shift+/'], expected: 'Shift+?' },
  { keys: ['Shift+[Slash]', '?', 'Shift+/'], expected: 'Shift+[Slash]' },
  { keys: ['?', 'Shift+/'], expected: '?' },
  { keys: ['Shift+/'], expected: 'Shift+/' },
])('prefers $expected among matching printed and physical strokes', ({ keys, expected }) => {
  const calls: string[] = []
  dispatcher = createBrowserDispatcher({
    platform: 'linux',
    keymap: keys.map((keys) => ({ keys, command: keys })),
  })
  dispatcher
    .createNode({
      commands: Object.fromEntries(keys.map((keys) => [keys, () => void calls.push(keys)])),
    })
    .focus()

  key({ key: '?', code: 'Slash', shiftKey: true })

  expect(calls).toEqual([expected])
})

test.each([
  { binding: 'Shift+?', event: { key: '?', code: 'Slash' } },
  { binding: '[Slash]', event: { key: '?', code: 'Slash', shiftKey: true } },
  { binding: 'Shift+[Slash]', event: { key: '?', code: 'Equal', shiftKey: true } },
  { binding: 'A', event: { key: 'A', code: 'KeyA', shiftKey: true } },
  { binding: 'Ж', event: { key: 'Ж', code: 'KeyF', shiftKey: true } },
  { binding: 'Enter', event: { key: 'Enter', code: 'Enter', shiftKey: true } },
  { binding: 'Control+?', event: { key: '?', code: 'Slash', shiftKey: true } },
  {
    binding: 'Control+?',
    event: { key: '?', code: 'Slash', ctrlKey: true, altKey: true, shiftKey: true },
  },
  { binding: '?', event: { key: '?', code: 'Slash', shiftKey: true, isComposing: true } },
])(
  'keeps the modifier/code/composition boundary for $binding with $event',
  ({ binding, event }) => {
    const callback = vi.fn()
    dispatcher = createBrowserDispatcher({
      platform: 'linux',
      keymap: [{ keys: binding, command: 'run' }],
    })
    dispatcher.createNode({ commands: { run: callback } }).focus()

    expect(key(event).defaultPrevented).toBe(false)
    expect(callback).not.toHaveBeenCalled()
    expect(dispatcher.pending()).toBeNull()
  },
)

test('AltGraph Shift produces the printed glyph without triggering Control+Alt', () => {
  const calls: string[] = []
  dispatcher = createBrowserDispatcher({
    platform: 'windows',
    keymap: [
      { keys: 'Control+Alt+?', command: 'shortcut' },
      { keys: '?', command: 'glyph' },
    ],
  })
  dispatcher
    .createNode({
      commands: {
        shortcut: () => void calls.push('shortcut'),
        glyph: () => void calls.push('glyph'),
      },
    })
    .focus()

  const source = key(
    { key: '?', code: 'Slash', ctrlKey: true, altKey: true, shiftKey: true },
    'keydown',
    true,
  )

  expect(matchesKeyboardEvent(source, '?', 'windows')).toBe(true)
  expect(matchesKeyboardEvent(source, 'Control+Alt+?', 'windows')).toBe(false)
  expect(calls).toEqual(['glyph'])
})

const altGraphLatinCases = (
  [
    { glyph: 'é', code: 'KeyE', fallback: 'E' },
    { glyph: 'ø', code: 'KeyO', fallback: 'O' },
    { glyph: 'ß', code: 'KeyS', fallback: 'S' },
  ] as const
).flatMap((input) =>
  (['keydown', 'keyup'] as const).map((eventType) => Object.assign({ eventType }, input)),
)

test.each(altGraphLatinCases)(
  'AltGraph typing $glyph does not fire $fallback on $eventType',
  ({ glyph, code, fallback, eventType }) => {
    registry = createHotkeyRegistry()
    const shortcut = vi.fn()
    const printed = vi.fn()
    const handle = registry.register(fallback, shortcut, { platform: 'windows', eventType })
    const input = { key: glyph, code, ctrlKey: true, altKey: true }

    const source = key(input, eventType, true)

    expect(matchesKeyboardEvent(source, fallback, 'windows')).toBe(false)
    expect(shortcut).not.toHaveBeenCalled()
    expect(source.defaultPrevented).toBe(false)
    handle.unregister()
    registry.register({ key: glyph }, printed, { platform: 'windows', eventType })
    expect(key(input, eventType, true).defaultPrevented).toBe(true)
    expect(printed).toHaveBeenCalledOnce()
  },
)

test.each([
  {
    name: 'native accented Latin',
    binding: 'Control+E',
    event: { key: 'é', code: 'KeyE', ctrlKey: true },
    matches: false,
  },
  {
    name: 'Alt transformed Latin',
    binding: 'Alt+E',
    event: { key: 'é', code: 'KeyE', altKey: true },
    matches: true,
  },
  {
    name: 'non-Latin positional fallback',
    binding: 'Control+E',
    event: { key: 'е', code: 'KeyE', ctrlKey: true },
    matches: true,
  },
] as const)('agrees with the helper for $name input', ({ binding, event, matches }) => {
  const callback = vi.fn()
  dispatcher = createBrowserDispatcher({
    platform: 'linux',
    keymap: [{ keys: binding, command: 'run' }],
  })
  dispatcher.createNode({ commands: { run: callback } }).focus()

  const source = key(event)

  expect(matchesKeyboardEvent(source, binding, 'linux')).toBe(matches)
  expect(callback).toHaveBeenCalledTimes(matches ? 1 : 0)
  expect(source.defaultPrevented).toBe(matches)
})

test.each(['string', 'raw'] as const)(
  'registry %s punctuation matches on both keydown and keyup',
  (kind) => {
    registry = createHotkeyRegistry()
    const hotkey: RegisterableHotkey = kind === 'string' ? 'Control+?' : { key: '?', ctrl: true }
    const calls: string[] = []
    registry.register(hotkey, () => void calls.push('down'), { platform: 'linux' })
    registry.register(hotkey, () => void calls.push('up'), {
      platform: 'linux',
      eventType: 'keyup',
    })
    const event = { key: '?', code: 'Slash', ctrlKey: true, shiftKey: true }

    key(event)
    key(event, 'keyup')

    expect(calls).toEqual(['down', 'up'])
  },
)

test.each(['string', 'raw'] as const)(
  'registry %s sequences use the same punctuation matching',
  (kind) => {
    registry = createHotkeyRegistry()
    const keys: HotkeyKeys = kind === 'string' ? ['G', '?'] : [{ key: 'G' }, { key: '?' }]
    const callback = vi.fn()
    registry.register(keys, callback, { platform: 'linux' })
    expect(key({ key: 'g', code: 'KeyG' }).defaultPrevented).toBe(true)
    const completion = key({ key: '?', code: 'Slash', shiftKey: true })
    expect(callback).toHaveBeenCalledOnce()
    expect(callback.mock.calls[0]?.[0]).toBe(completion)
    expect(registry.dispatcher.pending()).toBeNull()
  },
)
