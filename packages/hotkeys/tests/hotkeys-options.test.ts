import { afterEach, expect, test, vi } from 'vitest'
import { createHotkeyRegistry, detectPlatform } from '../src/index.js'
import type { HotkeyKeys, HotkeyOptions, HotkeyRegistry, RawHotkey, Target } from '../src/index.js'

let registry: HotkeyRegistry | undefined

afterEach(() => {
  registry?.dispose()
  registry = undefined
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.replaceChildren()
})

function setup() {
  registry = createHotkeyRegistry({ timeoutMs: 25 })
  return registry
}

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}, type = 'keydown') {
  const event = new KeyboardEvent(
    type,
    Object.assign(
      {
        key,
        code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
        bubbles: true,
        cancelable: true,
      },
      init,
    ),
  )
  target.dispatchEvent(event)
  return event
}

function panels() {
  const first = document.createElement('div')
  const second = document.createElement('div')
  document.body.append(first, second)
  return { first, second }
}

test('setOptions remains a patch while replaceOptions restores omitted behavior and metadata', () => {
  const callback = vi.fn()
  const hotkeys = setup()
  const { first, second } = panels()
  const handle = hotkeys.register('F8', callback, {
    enabled: false,
    preventDefault: false,
    stopPropagation: false,
    target: first,
    meta: { name: 'old' },
  })
  handle.setOptions({ meta: { name: 'patched' } })
  expect(hotkeys.registrations.state.get(handle.id)?.options).toMatchObject({
    enabled: false,
    preventDefault: false,
    stopPropagation: false,
    meta: { name: 'patched' },
  })
  press(first, 'F8')
  expect(callback).not.toHaveBeenCalled()
  handle.setOptions({ enabled: true })
  expect(press(first, 'F8').defaultPrevented).toBe(false)
  press(second, 'F8')
  expect(callback).toHaveBeenCalledOnce()

  handle.replaceOptions({})
  const view = hotkeys.registrations.state.get(handle.id)!
  expect(view.target).toBe(document)
  expect(view.options.meta).toBeUndefined()
  expect(view.triggerCount).toBe(1)
  expect(press(second, 'F8').defaultPrevented).toBe(true)
  expect(callback).toHaveBeenCalledTimes(2)
  expect(handle.isActive).toBe(true)
})

test.each([
  { keys: 'K', key: 'k', event: {}, defaultIgnore: true },
  { keys: 'Alt+K', key: 'k', event: { altKey: true }, defaultIgnore: true },
  { keys: 'Control+K', key: 'k', event: { ctrlKey: true }, defaultIgnore: false },
  { keys: 'Escape', key: 'Escape', event: {}, defaultIgnore: false },
] as const)(
  'replacement recomputes the input default for $keys',
  ({ keys, key, event, defaultIgnore }) => {
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    const callback = vi.fn()
    const hotkeys = setup()
    const handle = hotkeys.register(keys, callback, { ignoreInputs: !defaultIgnore })
    handle.replaceOptions({})
    expect(hotkeys.registrations.state.get(handle.id)?.options.ignoreInputs).toBe(defaultIgnore)
    press(input, key, event)
    expect(callback).toHaveBeenCalledTimes(defaultIgnore ? 0 : 1)
  },
)

test('an explicitly undefined patched option returns to its computed default', () => {
  const input = document.createElement('input')
  document.body.append(input)
  input.focus()
  const callback = vi.fn()
  const hotkeys = setup()
  const handle = hotkeys.register('K', callback, { ignoreInputs: false, meta: { name: 'keep' } })
  handle.setOptions({ ignoreInputs: undefined })
  expect(hotkeys.registrations.state.get(handle.id)?.options).toMatchObject({
    ignoreInputs: true,
    meta: { name: 'keep' },
  })
  press(input, 'k')
  expect(callback).not.toHaveBeenCalled()
})

test('removing stopPropagation restores the default event effect', () => {
  const hotkeys = setup()
  const handle = hotkeys.register('F8', vi.fn(), { stopPropagation: false })
  const bubbled = vi.fn()
  window.addEventListener('keydown', bubbled)
  try {
    press(document, 'F8')
    expect(bubbled).toHaveBeenCalledOnce()
    handle.replaceOptions({})
    press(document, 'F8')
    expect(bubbled).toHaveBeenCalledOnce()
  } finally {
    window.removeEventListener('keydown', bubbled)
  }
})

test('removing requireReset allows subsequent repeats', () => {
  const callback = vi.fn()
  const handle = setup().register('F8', callback, { requireReset: true })
  press(document, 'F8')
  press(document, 'F8', { repeat: true })
  expect(callback).toHaveBeenCalledOnce()
  handle.replaceOptions({})
  press(document, 'F8', { repeat: true })
  expect(callback).toHaveBeenCalledTimes(2)
})

const platformCases: ReadonlyArray<{
  name: string
  keys: HotkeyKeys
  strokes: ReadonlyArray<readonly [string, string]>
}> = [
  { name: 'string', keys: 'Mod+S', strokes: [['s', 'KeyS']] },
  { name: 'raw', keys: { key: 'S', mod: true }, strokes: [['s', 'KeyS']] },
  { name: 'physical string', keys: 'Mod+[KeyS]', strokes: [['x', 'KeyS']] },
  { name: 'physical raw', keys: { code: 'KeyS', mod: true }, strokes: [['x', 'KeyS']] },
  {
    name: 'string sequence',
    keys: ['Mod+K', 'Mod+C'],
    strokes: [
      ['k', 'KeyK'],
      ['c', 'KeyC'],
    ],
  },
  {
    name: 'raw sequence',
    keys: [
      { key: 'K', mod: true },
      { key: 'C', mod: true },
    ],
    strokes: [
      ['k', 'KeyK'],
      ['c', 'KeyC'],
    ],
  },
]

test.each(platformCases)(
  'platform changes rebind a $name without replacing its handle',
  ({ keys, strokes }) => {
    const callback = vi.fn()
    const hotkeys = setup()
    const handle = hotkeys.register(keys, callback, { platform: 'linux' })
    for (const [key, code] of strokes) press(document, key, { code, ctrlKey: true })
    expect(callback).toHaveBeenCalledOnce()
    const before = hotkeys.registrations.state.get(handle.id)!
    handle.setOptions({ platform: 'mac' })
    const after = hotkeys.registrations.state.get(handle.id)!
    expect(after.id).toBe(before.id)
    expect(after.triggerCount).toBe(1)
    expect(after.options.platform).toBe('mac')
    expect(after.strokes.every((stroke) => stroke.meta && !stroke.ctrl)).toBe(true)
    expect(handle.callback).toBe(callback)

    for (const [key, code] of strokes) press(document, key, { code, ctrlKey: true })
    expect(callback).toHaveBeenCalledOnce()
    for (const [key, code] of strokes) press(document, key, { code, metaKey: true })
    expect(callback).toHaveBeenCalledTimes(2)
    expect(callback.mock.lastCall?.[1].parsedHotkey).toMatchObject({ meta: true, ctrl: false })
    expect(hotkeys.trigger(handle.id)).toBe(true)
    expect(callback.mock.lastCall?.[0].metaKey).toBe(true)
    expect(hotkeys.registrations.state.get(handle.id)?.triggerCount).toBe(3)
  },
)

test('literal Control remains literal when platform-dependent display text changes', () => {
  const callback = vi.fn()
  const hotkeys = setup()
  const handle = hotkeys.register('Control+S', callback, { platform: 'linux' })
  expect(hotkeys.registrations.state.get(handle.id)?.hotkey).toBe('Mod+S')
  handle.setOptions({ platform: 'mac' })
  expect(hotkeys.registrations.state.get(handle.id)?.hotkey).toBe('Control+S')
  press(document, 's', { metaKey: true })
  expect(callback).not.toHaveBeenCalled()
  press(document, 's', { ctrlKey: true })
  expect(callback.mock.lastCall?.[1]).toMatchObject({
    hotkey: 'Control+S',
    parsedHotkey: { ctrl: true, meta: false },
  })
})

test('original raw keys and their list are snapshotted before platform reparsing', () => {
  const raw = { key: 'S', mod: true }
  const keys: RawHotkey[] = [raw]
  const callback = vi.fn()
  const hotkeys = setup()
  const handle = hotkeys.register(keys, callback, { platform: 'linux' })
  raw.key = 'X'
  keys.push({ key: 'Y', mod: true })
  handle.setOptions({ platform: 'mac' })
  press(document, 's', { metaKey: true })
  expect(callback).toHaveBeenCalledOnce()
  expect(hotkeys.registrations.state.get(handle.id)?.strokes).toHaveLength(1)
})

test('replacement removes an explicit platform and resolves the current default', () => {
  const platform = detectPlatform()
  const callback = vi.fn()
  const hotkeys = setup()
  const handle = hotkeys.register('Mod+S', callback, {
    platform: platform === 'mac' ? 'linux' : 'mac',
  })
  handle.replaceOptions({})
  expect(hotkeys.registrations.state.get(handle.id)?.options.platform).toBe(platform)
  press(document, 's', { ctrlKey: platform !== 'mac', metaKey: platform === 'mac' })
  expect(callback).toHaveBeenCalledOnce()
})

test('an effective no-op still replaces configured platform intent', () => {
  const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux')
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Linux')
  const callback = vi.fn()
  const hotkeys = setup()
  const handle = hotkeys.register('Mod+S', callback, { platform: 'linux' })
  const before = hotkeys.registrations.state
  handle.replaceOptions({})
  expect(hotkeys.registrations.state).toBe(before)
  platform.mockReturnValue('MacIntel')
  handle.setOptions({ meta: { name: 'save' } })
  expect(hotkeys.registrations.state.get(handle.id)?.options.platform).toBe('mac')
  press(document, 's', { metaKey: true })
  expect(callback).toHaveBeenCalledOnce()
})

test('retargeting updates filtering and re-arms requireReset without replacing identity', () => {
  const { first, second } = panels()
  const callback = vi.fn()
  const hotkeys = setup()
  const handle = hotkeys.register('F8', callback, { target: first, requireReset: true })
  press(first, 'F8')
  handle.setOptions({ target: second })
  const view = hotkeys.registrations.state.get(handle.id)!
  expect(view.target).toBe(second)
  expect(view.options.target).toBe(second)
  expect(view.triggerCount).toBe(1)
  press(first, 'F8')
  expect(callback).toHaveBeenCalledOnce()
  press(second, 'F8')
  expect(callback).toHaveBeenCalledTimes(2)
  handle.setOptions({ target: null })
  expect(hotkeys.registrations.state.get(handle.id)?.target).toBe(document)
  press(document.body, 'F8')
  expect(callback).toHaveBeenCalledTimes(3)
})

test('event-type changes and platform changes re-arm requireReset', () => {
  const callback = vi.fn()
  const hotkeys = setup()
  const handle = hotkeys.register('Mod+S', callback, { platform: 'linux', requireReset: true })
  press(document, 's', { ctrlKey: true })
  handle.setOptions({ platform: 'mac' })
  press(document, 's', { metaKey: true })
  expect(callback).toHaveBeenCalledTimes(2)
  handle.setOptions({ eventType: 'keyup' })
  press(document, 's', { metaKey: true })
  expect(callback).toHaveBeenCalledTimes(2)
  press(document, 's', { metaKey: true }, 'keyup')
  expect(callback).toHaveBeenCalledTimes(3)
  handle.setOptions({ eventType: 'keydown' })
  press(document, 's', { metaKey: true })
  expect(callback).toHaveBeenCalledTimes(4)
})

test('structural updates retain registration priority', () => {
  const calls: string[] = []
  const hotkeys = setup()
  const older = hotkeys.register('Mod+S', () => void calls.push('older'), {
    platform: 'linux',
    conflictBehavior: 'allow',
  })
  hotkeys.register('Control+S', () => (calls.push('newer'), false), {
    platform: 'linux',
    conflictBehavior: 'allow',
  })
  older.setOptions({ platform: 'mac' })
  older.setOptions({ platform: 'linux' })
  press(document, 's', { ctrlKey: true })
  expect(calls).toEqual(['newer', 'older'])
})

test.each(['target', 'platform', 'eventType'] as const)(
  'a conflicting %s update with error policy leaves the previous registration intact',
  (option) => {
    const { first, second } = panels()
    const hotkeys = setup()
    const callback = vi.fn()
    hotkeys.register('Control+S', vi.fn(), { platform: 'linux', target: first })
    const initial: HotkeyOptions = { platform: 'linux', target: first, conflictBehavior: 'allow' }
    if (option === 'target') initial.target = second
    if (option === 'platform') initial.platform = 'mac'
    if (option === 'eventType') initial.eventType = 'keyup'
    const handle = hotkeys.register('Mod+S', callback, initial)
    const before = hotkeys.registrations.state
    const next: HotkeyOptions = { conflictBehavior: 'error' }
    if (option === 'target') next.target = first
    if (option === 'platform') next.platform = 'linux'
    if (option === 'eventType') next.eventType = 'keydown'
    expect(() => handle.setOptions(next)).toThrow(/already registered/)
    expect(hotkeys.registrations.state).toBe(before)
    expect(handle.isActive).toBe(true)
    const target = option === 'target' ? second : first
    press(
      target,
      's',
      { ctrlKey: option !== 'platform', metaKey: option === 'platform' },
      option === 'eventType' ? 'keyup' : 'keydown',
    )
    expect(callback).toHaveBeenCalledOnce()
  },
)

test.each(['allow', 'warn', 'replace'] as const)(
  'retargeting applies the %s conflict policy',
  (conflictBehavior) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { first, second } = panels()
    const hotkeys = setup()
    const old = hotkeys.register('F8', vi.fn(), { target: first })
    const callback = vi.fn()
    const handle = hotkeys.register('F8', callback, { target: second, conflictBehavior })
    handle.setOptions({ target: first })
    expect(warn).toHaveBeenCalledTimes(conflictBehavior === 'warn' ? 1 : 0)
    expect(old.isActive).toBe(conflictBehavior !== 'replace')
    press(first, 'F8')
    expect(callback).toHaveBeenCalledOnce()
  },
)

test('changing only conflict policy does not reject an existing overlap', () => {
  const hotkeys = setup()
  hotkeys.register('F8', vi.fn())
  const handle = hotkeys.register('F8', vi.fn(), { conflictBehavior: 'allow' })
  expect(() => handle.setOptions({ conflictBehavior: 'error' })).not.toThrow()
  expect(handle.isActive).toBe(true)
})

test('equal display labels on different platforms do not create a false conflict', () => {
  const hotkeys = setup()
  const control = vi.fn()
  const meta = vi.fn()
  hotkeys.register('Mod+S', control, { platform: 'linux' })
  expect(() =>
    hotkeys.register('Mod+S', meta, { platform: 'mac', conflictBehavior: 'error' }),
  ).not.toThrow()
  press(document, 's', { ctrlKey: true })
  press(document, 's', { metaKey: true })
  expect(control).toHaveBeenCalledOnce()
  expect(meta).toHaveBeenCalledOnce()
})

test('different platform labels still conflict when their resolved strokes are identical', () => {
  const hotkeys = setup()
  hotkeys.register('Control+S', vi.fn(), { platform: 'mac' })
  expect(() =>
    hotkeys.register('Control+S', vi.fn(), { platform: 'linux', conflictBehavior: 'error' }),
  ).toThrow(/already registered/)
  expect(hotkeys.registrations.state.size).toBe(1)
})

const changedOptions: ReadonlyArray<{ name: string; options: HotkeyOptions }> = [
  { name: 'enabled', options: { enabled: false } },
  { name: 'eventType', options: { eventType: 'keyup' } },
  { name: 'ignoreInputs', options: { ignoreInputs: false } },
  { name: 'preventDefault', options: { preventDefault: false } },
  { name: 'stopPropagation', options: { stopPropagation: false } },
  { name: 'requireReset', options: { requireReset: true } },
]

test.each(changedOptions)(
  'removing $name cancels an old pending chord immediately',
  ({ options }) => {
    vi.useFakeTimers()
    const hotkeys = setup()
    const callback = vi.fn()
    const prefix = hotkeys.register('G', callback, options)
    hotkeys.register(['G', 'H'], callback)
    press(document, 'g')
    expect(hotkeys.dispatcher.pending()?.keys).toBe('G')
    prefix.replaceOptions({})
    expect(hotkeys.dispatcher.pending()).toBeNull()
    vi.advanceTimersByTime(100)
    expect(callback).not.toHaveBeenCalled()
  },
)

test('a behavior patch cancels a timed prefix before another key synchronizes the keymap', () => {
  vi.useFakeTimers()
  const hotkeys = setup()
  const callback = vi.fn()
  const prefix = hotkeys.register('G', callback)
  hotkeys.register(['G', 'H'], callback)
  press(document, 'g')
  prefix.setOptions({ enabled: false })
  expect(hotkeys.dispatcher.pending()).toBeNull()
  vi.advanceTimersByTime(100)
  expect(callback).not.toHaveBeenCalled()
})

test.each(['metadata', 'conflict policy', 'equivalent defaults'] as const)(
  'replacing %s preserves a pending chord',
  (change) => {
    const hotkeys = setup()
    const callback = vi.fn()
    const handle = hotkeys.register(
      ['G', 'H'],
      callback,
      change === 'metadata' ? { meta: { name: 'old' } } : {},
    )
    press(document, 'g')
    if (change === 'metadata') handle.replaceOptions({})
    if (change === 'conflict policy') handle.replaceOptions({ conflictBehavior: 'error' })
    if (change === 'equivalent defaults') {
      const before = hotkeys.registrations.state
      handle.replaceOptions({
        target: null,
        enabled: true,
        eventType: 'keydown',
        preventDefault: true,
        stopPropagation: true,
        requireReset: false,
      })
      expect(hotkeys.registrations.state).toBe(before)
    }
    expect(hotkeys.dispatcher.pending()?.keys).toBe('G')
    press(document, 'h')
    expect(callback).toHaveBeenCalledOnce()
  },
)

test('metadata replacement preserves requireReset and its trigger count', () => {
  const hotkeys = setup()
  const callback = vi.fn()
  const handle = hotkeys.register('F8', callback, { requireReset: true, meta: { name: 'old' } })
  press(document, 'F8')
  handle.replaceOptions({ requireReset: true })
  press(document, 'F8', { repeat: true })
  expect(callback).toHaveBeenCalledOnce()
  expect(hotkeys.registrations.state.get(handle.id)?.triggerCount).toBe(1)
  expect(hotkeys.registrations.state.get(handle.id)?.options.meta).toBeUndefined()
})

test.each(['setOptions', 'replaceOptions'] as const)(
  'inactive %s does not publish or interrupt live chords',
  (method) => {
    const hotkeys = setup()
    const inactive = hotkeys.register('F8', vi.fn())
    inactive.unregister()
    const callback = vi.fn()
    hotkeys.register(['G', 'H'], callback)
    press(document, 'g')
    const before = hotkeys.registrations.state
    inactive[method]({ enabled: false, platform: 'mac' })
    expect(hotkeys.registrations.state).toBe(before)
    expect(hotkeys.dispatcher.pending()?.keys).toBe('G')
    press(document, 'h')
    expect(callback).toHaveBeenCalledOnce()
  },
)

test.each(['document', 'window', 'element'] as const)(
  'foreign %s targets are rejected before registration or mutation',
  (kind) => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    const other = frame.contentDocument!
    const target: Target =
      kind === 'document' ? other : kind === 'window' ? frame.contentWindow! : other.body
    const hotkeys = setup()
    expect(() => hotkeys.register('F8', vi.fn(), { target })).toThrow(/registry document/)
    expect(hotkeys.registrations.state.size).toBe(0)
    const callback = vi.fn()
    const handle = hotkeys.register('F8', callback)
    const before = hotkeys.registrations.state
    expect(() => handle.setOptions({ target })).toThrow(/registry document/)
    expect(() => handle.replaceOptions({ target })).toThrow(/registry document/)
    expect(hotkeys.registrations.state).toBe(before)
    press(document, 'F8')
    expect(callback).toHaveBeenCalledOnce()
  },
)

test('a same-document Window is a supported scope', () => {
  const hotkeys = setup()
  const callback = vi.fn()
  const handle = hotkeys.register('F8', callback)
  handle.setOptions({ target: window })
  press(document.body, 'F8')
  expect(callback).toHaveBeenCalledOnce()
  expect(hotkeys.registrations.state.get(handle.id)?.target).toBe(window)
})
