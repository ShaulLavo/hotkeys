import { afterEach, expect, test, vi } from 'vitest'
import { createBrowserDispatcher, createDispatcher, createKeyInput } from '../../src/index.js'
import type {
  BrowserDispatcher,
  CommandEvent,
  CompiledBinding,
  Dispatcher,
  KeyInput,
  KeymapSequenceEvent,
} from '../../src/index.js'

type Source = { readonly key: string }
type Stroke = { readonly input: KeyInput; readonly source: Source }

let dispatcher: Dispatcher<Source> | undefined
let browser: BrowserDispatcher | undefined
afterEach(() => {
  dispatcher?.dispose()
  dispatcher = undefined
  browser?.dispose()
  browser = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(document, 'execCommand')
  vi.useRealTimers()
})

function stroke(key: string): Stroke {
  return {
    input: createKeyInput({ key, code: `Key${key.toUpperCase()}` }),
    source: { key },
  }
}

function send(entry: Stroke) {
  return dispatcher!.handleKey(entry.input, entry.source)
}

function summarize(events: readonly KeymapSequenceEvent<CompiledBinding>[]) {
  return events.map((event) => ({
    keys: event.keys,
    outcome: event.outcome,
    command: event.binding?.payload.command,
  }))
}

const handlerInterruptions = (['cancel', 'setKeymap', 'focus'] as const).flatMap((action) =>
  (['same node', 'ancestor'] as const).flatMap((scope) =>
    (['single', 'completion', 'timeout', 'mismatch'] as const).map((route) => ({
      action,
      scope,
      route,
    })),
  ),
)

test('the host focus reader can derive its token from the public context stack', () => {
  const command = vi.fn()
  dispatcher = createDispatcher<Source>({
    platform: 'linux',
    keymap: [{ keys: 'G', command: 'action' }],
    currentFocus: () => dispatcher!.contextStack().length,
  })
  dispatcher.createNode({ context: 'Editor', commands: { action: command } }).focus()

  expect(dispatcher.contextStack()).toHaveLength(1)
  expect(send(stroke('g'))).toBe(true)
  expect(command).toHaveBeenCalledOnce()
})

test.each(handlerInterruptions)(
  '$action during $route stops later handlers for the same command on the $scope',
  ({ action, scope, route }) => {
    vi.useFakeTimers()
    const calls: string[] = []
    const keys = route === 'single' ? 'G' : 'G H'
    const keymap = [{ keys, command: 'action' }]
    if (route === 'timeout' || route === 'mismatch')
      keymap.push({ keys: 'G H I', command: 'longer' })
    dispatcher = createDispatcher<Source>({ platform: 'linux', timeoutMs: 25, keymap })
    const destination = dispatcher.createNode()
    const stale = () => void calls.push('stale')
    const interrupt = () => {
      calls.push('interrupt')
      if (action === 'cancel') dispatcher!.cancel()
      else if (action === 'setKeymap') dispatcher!.setKeymap([])
      else destination.focus()
      return false
    }
    const parent = dispatcher.createNode({
      commands: scope === 'ancestor' ? { action: stale } : {},
    })
    const child = dispatcher.createNode({ parent, commands: { action: interrupt } })
    if (scope === 'same node') child.handle('action', stale)
    child.focus()

    send(stroke('g'))
    if (route !== 'single') send(stroke('h'))
    if (route === 'timeout') vi.advanceTimersByTime(25)
    if (route === 'mismatch') send(stroke('q'))

    expect(calls).toEqual(['interrupt'])
    expect(dispatcher.pending()).toBeNull()
  },
)

test('a successful command can start a new chord without replaying or completing it', () => {
  const replay = vi.fn()
  const sequences: KeymapSequenceEvent<CompiledBinding>[] = []
  const commands: CommandEvent<Source>[] = []
  const nested = stroke('x')
  let nestedOwned: boolean | undefined
  dispatcher = createDispatcher<Source>({
    platform: 'linux',
    keymap: [
      { keys: 'G H', command: 'outer' },
      { keys: 'X Y', command: 'nested' },
    ],
    replay,
    onSequence: (event) => sequences.push(event),
  })
  dispatcher
    .createNode({
      commands: {
        outer: (event) => {
          commands.push(event)
          nestedOwned = send(nested)
          return true
        },
        nested: (event) => void commands.push(event),
      },
    })
    .focus()
  expect(send(stroke('g'))).toBe(true)
  const completion = stroke('h')
  expect(send(completion)).toBe(true)

  expect(nestedOwned).toBe(true)
  expect(replay).not.toHaveBeenCalled()
  expect(dispatcher.pending()).toEqual({ keys: 'X', candidateCount: 1 })
  expect(summarize(sequences)).toEqual([{ keys: 'G', outcome: 'completed', command: 'outer' }])
  expect(commands).toHaveLength(1)
  expect(commands[0]?.input).toBe(completion.input)
  expect(commands[0]?.source).toBe(completion.source)

  const nestedCompletion = stroke('y')
  expect(send(nestedCompletion)).toBe(true)
  expect(replay).not.toHaveBeenCalled()
  expect(dispatcher.pending()).toBeNull()
  expect(summarize(sequences)).toEqual([
    { keys: 'G', outcome: 'completed', command: 'outer' },
    { keys: 'X', outcome: 'completed', command: 'nested' },
  ])
  expect(commands).toHaveLength(2)
  expect(commands[1]?.input).toBe(nestedCompletion.input)
  expect(commands[1]?.source).toBe(nestedCompletion.source)
})

test('a synchronously completed nested chord keeps its own report and triggering input', () => {
  const replay = vi.fn()
  const sequences: KeymapSequenceEvent<CompiledBinding>[] = []
  const commands: CommandEvent<Source>[] = []
  const nestedStart = stroke('x')
  const nestedCompletion = stroke('y')
  const nestedOwnership: boolean[] = []
  dispatcher = createDispatcher<Source>({
    platform: 'linux',
    keymap: [
      { keys: 'G H', command: 'outer' },
      { keys: 'X Y', command: 'nested' },
    ],
    replay,
    onSequence: (event) => sequences.push(event),
  })
  dispatcher
    .createNode({
      commands: {
        outer: (event) => {
          commands.push(event)
          nestedOwnership.push(send(nestedStart), send(nestedCompletion))
          return true
        },
        nested: (event) => void commands.push(event),
      },
    })
    .focus()
  send(stroke('g'))
  const completion = stroke('h')
  expect(send(completion)).toBe(true)

  expect(nestedOwnership).toEqual([true, true])
  expect(replay).not.toHaveBeenCalled()
  expect(dispatcher.pending()).toBeNull()
  expect(summarize(sequences)).toEqual([
    { keys: 'X', outcome: 'completed', command: 'nested' },
    { keys: 'G', outcome: 'completed', command: 'outer' },
  ])
  expect(commands.map((event) => event.command)).toEqual(['outer', 'nested'])
  expect(commands[0]?.input).toBe(completion.input)
  expect(commands[0]?.source).toBe(completion.source)
  expect(commands[1]?.input).toBe(nestedCompletion.input)
  expect(commands[1]?.source).toBe(nestedCompletion.source)
})

test.each(['acceptsTextInput', 'swallow'] as const)(
  'nested input from %s while preparing a fresh prefix preserves the current stroke',
  (callback) => {
    const replayed: Stroke[] = []
    const swallowed: Source[] = []
    const nested = stroke('x')
    const current = stroke('g')
    const command = vi.fn()
    let reentered = false
    function startNested(source: Source) {
      if (source !== current.source || reentered) return
      reentered = true
      expect(send(nested)).toBe(true)
    }
    dispatcher = createDispatcher<Source>({
      platform: 'linux',
      keymap: [
        { keys: 'G H', command: 'outer' },
        { keys: 'X Y', command: 'nested' },
      ],
      acceptsTextInput: (source) => {
        if (callback === 'acceptsTextInput') startNested(source)
        return false
      },
      effects: {
        preventDefault: () => {},
        stopPropagation: () => {},
        swallow: (source) => {
          swallowed.push(source)
          if (callback === 'swallow') startNested(source)
        },
      },
      replay: (input, source) => replayed.push({ input, source }),
    })
    dispatcher.createNode({ commands: { outer: command, nested: command } }).focus()

    expect(send(current)).toBe(callback === 'swallow')

    expect(dispatcher.pending()).toEqual({ keys: 'X', candidateCount: 1 })
    expect(command).not.toHaveBeenCalled()
    if (callback === 'acceptsTextInput') {
      expect(swallowed).not.toContain(current.source)
      expect(replayed).toEqual([])
    } else {
      expect(swallowed.filter((source) => source === current.source)).toHaveLength(1)
      expect(replayed).toHaveLength(1)
      expect(replayed[0]?.input).toBe(current.input)
      expect(replayed[0]?.source).toBe(current.source)
    }
    expect(send(stroke('y'))).toBe(true)
    expect(command).toHaveBeenCalledOnce()
    expect(dispatcher.pending()).toBeNull()
  },
)

test.each(['acceptsTextInput', 'swallow'] as const)(
  'nested input from %s while resuming a suffix preserves its detached strokes',
  (callback) => {
    const replayed: Stroke[] = []
    const swallowed: Source[] = []
    const first = stroke('a')
    const suffix = stroke('b')
    const current = stroke('d')
    const nested = stroke('x')
    const command = vi.fn()
    let reentered = false
    function startNested(source: Source) {
      if (source !== current.source || reentered) return
      reentered = true
      expect(send(nested)).toBe(true)
    }
    dispatcher = createDispatcher<Source>({
      platform: 'linux',
      keymap: [
        { keys: 'A B C', command: 'outer' },
        { keys: 'B D E', command: 'resumed' },
        { keys: 'X Y', command: 'nested' },
      ],
      acceptsTextInput: (source) => {
        if (callback === 'acceptsTextInput') startNested(source)
        return false
      },
      effects: {
        preventDefault: () => {},
        stopPropagation: () => {},
        swallow: (source) => {
          swallowed.push(source)
          if (callback === 'swallow') startNested(source)
        },
      },
      replay: (input, source) => replayed.push({ input, source }),
    })
    dispatcher
      .createNode({ commands: { outer: command, resumed: command, nested: command } })
      .focus()
    expect(send(first)).toBe(true)
    expect(send(suffix)).toBe(true)

    expect(send(current)).toBe(callback === 'swallow')

    expect(dispatcher.pending()).toEqual({ keys: 'X', candidateCount: 1 })
    expect(command).not.toHaveBeenCalled()
    const restored = callback === 'swallow' ? [first, suffix, current] : [first, suffix]
    expect(replayed).toHaveLength(restored.length)
    for (const [index, entry] of restored.entries()) {
      expect(replayed[index]?.input).toBe(entry.input)
      expect(replayed[index]?.source).toBe(entry.source)
    }
    if (callback === 'acceptsTextInput') expect(swallowed).not.toContain(current.source)
    else expect(swallowed.filter((source) => source === current.source)).toHaveLength(1)
    expect(send(stroke('y'))).toBe(true)
    expect(command).toHaveBeenCalledOnce()
    expect(dispatcher.pending()).toBeNull()
  },
)

test.each([
  ['dispose', 'timeout'],
  ['dispose', 'mismatch'],
  ['setKeymap', 'timeout'],
  ['setKeymap', 'mismatch'],
] as const)('%s during %s stops stale candidates and buffered input', (action, reason) => {
  vi.useFakeTimers()
  const calls: string[] = []
  const replay = vi.fn()
  dispatcher = createDispatcher<Source>({
    platform: 'linux',
    timeoutMs: 25,
    keymap: [
      { keys: 'G H', command: 'fallback' },
      { keys: 'G H', command: 'interrupt' },
      { keys: 'G H I J', command: 'long' },
      { keys: 'I', command: 'suffix' },
      { keys: 'X', command: 'current' },
    ],
    replay,
  })
  dispatcher
    .createNode({
      commands: {
        interrupt: () => {
          calls.push('interrupt')
          if (action === 'dispose') dispatcher!.dispose()
          else {
            dispatcher!.setKeymap([
              { keys: 'I', command: 'replacement' },
              { keys: 'X', command: 'replacement' },
            ])
          }
          return false
        },
        fallback: () => void calls.push('fallback'),
        suffix: () => void calls.push('suffix'),
        current: () => void calls.push('current'),
        replacement: () => void calls.push('replacement'),
      },
    })
    .focus()
  for (const key of ['g', 'h', 'i']) expect(send(stroke(key))).toBe(true)

  if (reason === 'timeout') vi.advanceTimersByTime(25)
  else send(stroke('x'))

  expect(calls).toEqual(['interrupt'])
  expect(replay).not.toHaveBeenCalled()
  expect(dispatcher.pending()).toBeNull()
  vi.advanceTimersByTime(100)
  expect(calls).toEqual(['interrupt'])
  expect(replay).not.toHaveBeenCalled()

  expect(send(stroke('i'))).toBe(action === 'setKeymap')
  expect(calls).toEqual(action === 'setKeymap' ? ['interrupt', 'replacement'] : ['interrupt'])
})

test.each([
  ['cancel', 'fresh'],
  ['setKeymap', 'fresh'],
  ['cancel', 'mismatch'],
  ['setKeymap', 'mismatch'],
] as const)('%s in a declining %s single leaves its key and release unowned', (action, route) => {
  const replayed: string[] = []
  dispatcher = createDispatcher<Source>({
    platform: 'linux',
    keymap: [
      { keys: 'G H', command: 'chord' },
      { keys: 'Tab', command: 'maybeIndent' },
    ],
    replay: (input) => replayed.push(input.key),
  })
  const maybeIndent = vi.fn(() => {
    if (action === 'cancel') dispatcher!.cancel()
    else dispatcher!.setKeymap([])
    return false
  })
  dispatcher.createNode({ commands: { maybeIndent } }).focus()
  if (route === 'mismatch') expect(send(stroke('g'))).toBe(true)
  const source = { key: 'Tab' }

  expect(dispatcher.handleKey(createKeyInput({ key: 'Tab', code: 'Tab' }), source)).toBe(false)

  expect(maybeIndent).toHaveBeenCalledOnce()
  expect(replayed).toEqual(route === 'mismatch' ? ['G'] : [])
  expect(dispatcher.pending()).toBeNull()
  expect(
    dispatcher.handleKey(createKeyInput({ key: 'Tab', code: 'Tab', type: 'keyup' }), source),
  ).toBe(false)
})

test.each(['preventDefault', 'stopPropagation'] as const)(
  'explicit %s still owns a single whose declining handler cancels',
  (option) => {
    dispatcher = createDispatcher<Source>({
      platform: 'linux',
      keymap: [{ keys: 'Tab', command: 'maybeIndent', [option]: true }],
    })
    const maybeIndent = vi.fn(() => {
      dispatcher!.cancel()
      return false
    })
    dispatcher.createNode({ commands: { maybeIndent } }).focus()
    const source = { key: 'Tab' }

    expect(dispatcher.handleKey(createKeyInput({ key: 'Tab', code: 'Tab' }), source)).toBe(true)

    expect(maybeIndent).toHaveBeenCalledOnce()
    expect(
      dispatcher.handleKey(createKeyInput({ key: 'Tab', code: 'Tab', type: 'keyup' }), source),
    ).toBe(true)
  },
)

test.each(['dispose', 'setKeymap'] as const)(
  '%s from replay stops the remaining buffered strokes',
  (action) => {
    vi.useFakeTimers()
    const replayed: Stroke[] = []
    const replacement = vi.fn()
    dispatcher = createDispatcher<Source>({
      platform: 'linux',
      timeoutMs: 25,
      keymap: [{ keys: 'G H I J', command: 'long' }],
      acceptsTextInput: () => true,
      replay: (input, source) => {
        replayed.push({ input, source })
        if (action === 'dispose') dispatcher!.dispose()
        else {
          dispatcher!.setKeymap([
            { keys: 'H', command: 'replacement' },
            { keys: 'I', command: 'replacement' },
          ])
        }
      },
    })
    dispatcher.createNode({ commands: { replacement } }).focus()
    const buffered = [stroke('g'), stroke('h'), stroke('i')]
    for (const entry of buffered) expect(send(entry)).toBe(true)

    vi.advanceTimersByTime(25)

    expect(replayed).toHaveLength(1)
    expect(replayed[0]?.input).toBe(buffered[0]!.input)
    expect(replayed[0]?.source).toBe(buffered[0]!.source)
    expect(replacement).not.toHaveBeenCalled()
    expect(dispatcher.pending()).toBeNull()
    expect(send(stroke('h'))).toBe(action === 'setKeymap')
    expect(replacement).toHaveBeenCalledTimes(action === 'setKeymap' ? 1 : 0)
  },
)

test('a declining command that changes the focused node drops its old buffered input', () => {
  const replay = vi.fn()
  const sequences: KeymapSequenceEvent<CompiledBinding>[] = []
  dispatcher = createDispatcher<Source>({
    platform: 'linux',
    keymap: [{ keys: 'G H', command: 'move' }],
    replay,
    onSequence: (event) => sequences.push(event),
  })
  const next = dispatcher.createNode()
  const move = vi.fn(() => {
    next.focus()
    return false
  })
  dispatcher.createNode({ commands: { move } }).focus()
  expect(send(stroke('g'))).toBe(true)
  expect(send(stroke('h'))).toBe(false)

  expect(move).toHaveBeenCalledOnce()
  expect(dispatcher.focused()).toBe(next)
  expect(dispatcher.pending()).toBeNull()
  expect(replay).not.toHaveBeenCalled()
  expect(summarize(sequences)).toEqual([{ keys: 'G', outcome: 'superseded', command: undefined }])
})

function key(target: Element, value: string) {
  const event = new KeyboardEvent('keydown', {
    key: value,
    code: `Key${value.toUpperCase()}`,
    bubbles: true,
    cancelable: true,
    composed: true,
  })
  target.dispatchEvent(event)
  return event
}

test.each(['dispose', 'move focus'] as const)(
  '%s in a replayed input handler stops later characters reaching the old field',
  (action) => {
    vi.useFakeTimers()
    const first = document.createElement('textarea')
    const next = document.createElement('textarea')
    document.body.append(first, next)
    first.focus()
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false })
    const inserted: Array<string | null> = []
    first.addEventListener('input', (event) => {
      inserted.push((event as InputEvent).data)
      if (action === 'dispose') browser!.dispose()
      else next.focus()
    })
    const decline = vi.fn(() => false)
    browser = createBrowserDispatcher({
      platform: 'linux',
      timeoutMs: 25,
      keymap: [
        { keys: 'G H', command: 'decline' },
        { keys: 'G H I', command: 'long' },
      ],
    })
    browser.attachElement(browser.createNode({ commands: { decline } }), first)
    expect(key(first, 'g').defaultPrevented).toBe(true)
    expect(key(first, 'h').defaultPrevented).toBe(true)

    vi.advanceTimersByTime(25)

    expect(decline).toHaveBeenCalledOnce()
    expect(inserted).toEqual(['g'])
    expect(first.value).toBe('g')
    expect(next.value).toBe('')
    expect(browser.pending()).toBeNull()
    vi.advanceTimersByTime(100)
    expect(inserted).toEqual(['g'])
  },
)
