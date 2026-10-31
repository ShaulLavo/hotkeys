import { afterEach, expect, expectTypeOf, test, vi } from 'vitest'
import { createDispatcher, createKeyInput } from '../../src'
import type {
  ChordRuntimeOptions,
  CommandEvent,
  CommandHandler,
  Dispatcher,
  KeyInput,
  KeymapBinding,
  KeymapEntry,
} from '../../src'

type Source = { readonly key: string }

let dispatcher: Dispatcher<Source> | undefined
afterEach(() => {
  dispatcher?.dispose()
  dispatcher = undefined
  vi.useRealTimers()
})

function setup(keymap: readonly KeymapEntry[], commands: Record<string, CommandHandler<Source>>) {
  dispatcher = createDispatcher<Source>({ platform: 'linux', timeoutMs: 25, keymap })
  dispatcher.createNode({ commands }).focus()
  return dispatcher
}

function stroke(key: string) {
  return {
    input: createKeyInput({
      key,
      code: `Key${key.toUpperCase()}`,
      modifiers: { ctrl: true },
    }),
    source: { key },
  }
}

test.each(['timeout', 'mismatch'] as const)(
  'keeps the buffered prefix input and source together on %s',
  (outcome) => {
    vi.useFakeTimers()
    const events: CommandEvent<Source>[] = []
    const keys = setup(
      [
        { keys: 'Control+K', command: 'prefix' },
        { keys: 'Control+K Control+C', command: 'chord' },
        { keys: 'Control+X', command: 'other' },
      ],
      {
        prefix: (event) => void events.push(event),
        other: (event) => void events.push(event),
      },
    )
    const prefix = stroke('k')
    const other = stroke('x')
    keys.handleKey(prefix.input, prefix.source)
    expect(events).toEqual([])

    if (outcome === 'timeout') vi.advanceTimersByTime(25)
    else keys.handleKey(other.input, other.source)

    expect(events).toHaveLength(outcome === 'timeout' ? 1 : 2)
    expect(events[0]?.command).toBe('prefix')
    expect(events[0]?.input).toBe(prefix.input)
    expect(events[0]?.source).toBe(prefix.source)
    if (outcome === 'mismatch') {
      expect(events[1]?.command).toBe('other')
      expect(events[1]?.input).toBe(other.input)
      expect(events[1]?.source).toBe(other.source)
    }
  },
)

test('uses the last buffered stroke when a multi-stroke prefix times out', () => {
  vi.useFakeTimers()
  const events: CommandEvent<Source>[] = []
  const keys = setup(
    [
      { keys: 'Control+K Control+C', command: 'prefix' },
      { keys: 'Control+K Control+C Control+U', command: 'chord' },
    ],
    { prefix: (event) => void events.push(event) },
  )
  const first = stroke('k')
  const last = stroke('c')
  keys.handleKey(first.input, first.source)
  keys.handleKey(last.input, last.source)
  vi.advanceTimersByTime(25)

  expect(events).toHaveLength(1)
  expect(events[0]?.input).toBe(last.input)
  expect(events[0]?.source).toBe(last.source)
})

test('passes the final stroke when a chord completes normally', () => {
  const events: CommandEvent<Source>[] = []
  const keys = setup([{ keys: 'Control+K Control+C', command: 'chord' }], {
    chord: (event) => void events.push(event),
  })
  const first = stroke('k')
  const last = stroke('c')
  keys.handleKey(first.input, first.source)
  keys.handleKey(last.input, last.source)

  expect(events).toHaveLength(1)
  expect(events[0]?.input).toBe(last.input)
  expect(events[0]?.source).toBe(last.source)
})

test('passes the final stroke when buffered input resumes another chord', () => {
  const events: CommandEvent<Source>[] = []
  const keys = setup(
    [
      { keys: 'Control+A Control+B Control+C', command: 'original' },
      { keys: 'Control+B Control+D', command: 'resumed' },
    ],
    { resumed: (event) => void events.push(event) },
  )
  const first = stroke('a')
  const middle = stroke('b')
  const last = stroke('d')
  keys.handleKey(first.input, first.source)
  keys.handleKey(middle.input, middle.source)
  keys.handleKey(last.input, last.source)

  expect(events).toHaveLength(1)
  expect(events[0]?.command).toBe('resumed')
  expect(events[0]?.input).toBe(last.input)
  expect(events[0]?.source).toBe(last.source)
})

test('keeps input and source null for programmatic commands', () => {
  const events: CommandEvent<Source>[] = []
  const keys = setup([], { action: (event) => void events.push(event) })
  expect(keys.dispatchCommand('action')).toBe(true)
  expect(keys.dispatchCommandFrom(keys.focused()!, 'action')).toBe(true)

  expect(events).toHaveLength(2)
  for (const event of events) {
    expect(event.input).toBeNull()
    expect(event.source).toBeNull()
  }
})

test('nested key dispatch cannot change a later outer candidate input', () => {
  const events: CommandEvent<Source>[] = []
  const outer = stroke('k')
  const nested = stroke('x')
  const keys = setup(
    [
      { keys: 'Control+K', command: 'fallback' },
      { keys: 'Control+K', command: 'outer' },
      { keys: 'Control+X', command: 'nested' },
    ],
    {
      fallback: (event) => void events.push(event),
      outer: (event) => {
        events.push(event)
        keys.handleKey(nested.input, nested.source)
        return false
      },
      nested: (event) => void events.push(event),
    },
  )
  expect(keys.handleKey(outer.input, outer.source)).toBe(true)

  expect(events.map((event) => event.command)).toEqual(['outer', 'nested', 'fallback'])
  expect(events[0]?.input).toBe(outer.input)
  expect(events[0]?.source).toBe(outer.source)
  expect(events[1]?.input).toBe(nested.input)
  expect(events[1]?.source).toBe(nested.source)
  expect(events[2]?.input).toBe(outer.input)
  expect(events[2]?.source).toBe(outer.source)
})

test('keeps runtime dispatch callbacks compatible and infers their input', () => {
  type Dispatch = ChordRuntimeOptions<string, number, Source>['dispatch']
  type ExistingDispatch = (
    binding: KeymapBinding<string>,
    context: number,
    source: Source,
  ) => boolean
  expectTypeOf<ExistingDispatch>().toExtend<Dispatch>()
  const dispatch: Dispatch = (binding, context, source, input) => {
    expectTypeOf(binding).toEqualTypeOf<KeymapBinding<string>>()
    expectTypeOf(context).toEqualTypeOf<number>()
    expectTypeOf(source).toEqualTypeOf<Source>()
    expectTypeOf(input).toEqualTypeOf<KeyInput>()
    return true
  }
  expectTypeOf(dispatch).parameter(3).toEqualTypeOf<KeyInput>()
})
