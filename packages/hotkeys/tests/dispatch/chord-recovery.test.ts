import { afterEach, expect, test, vi } from 'vitest'
import { createDispatcher, createKeyInput } from '../../src'
import type { CommandEvent, Dispatcher, KeyInput } from '../../src'

type Source = { readonly key: string }
type Stroke = { readonly input: KeyInput; readonly source: Source }

let dispatcher: Dispatcher<Source> | undefined
afterEach(() => {
  dispatcher?.dispose()
  dispatcher = undefined
  vi.useRealTimers()
})

function stroke(key: string): Stroke {
  return {
    input: createKeyInput({ key, code: `Key${key.toUpperCase()}` }),
    source: { key },
  }
}

test.each(['timeout', 'mismatch'] as const)(
  'replays every declined buffered stroke once, in order, on %s',
  (outcome) => {
    vi.useFakeTimers()
    const replayed: Stroke[] = []
    const commands: CommandEvent<Source>[] = []
    const order: string[] = []
    dispatcher = createDispatcher<Source>({
      platform: 'linux',
      timeoutMs: 25,
      keymap: [
        { keys: 'G H', command: 'prefix' },
        { keys: 'G H I J', command: 'long' },
        { keys: 'X', command: 'other' },
      ],
      replay: (input, source) => {
        replayed.push({ input, source })
        order.push(`replay ${input.key}`)
      },
    })
    dispatcher
      .createNode({
        commands: {
          prefix: (event) => {
            commands.push(event)
            order.push('prefix')
            return false
          },
          other: (event) => {
            commands.push(event)
            order.push('other')
          },
        },
      })
      .focus()
    const buffered = [stroke('g'), stroke('h'), stroke('i')]
    const current = stroke('x')
    for (const entry of buffered) {
      expect(dispatcher.handleKey(entry.input, entry.source)).toBe(true)
    }
    expect(commands).toEqual([])

    if (outcome === 'timeout') vi.advanceTimersByTime(25)
    else expect(dispatcher.handleKey(current.input, current.source)).toBe(true)

    expect(order).toEqual(
      ['prefix', 'replay G', 'replay H', 'replay I'].concat(
        outcome === 'mismatch' ? ['other'] : [],
      ),
    )
    expect(replayed).toHaveLength(buffered.length)
    for (const [index, entry] of buffered.entries()) {
      expect(replayed[index]?.input).toBe(entry.input)
      expect(replayed[index]?.source).toBe(entry.source)
    }
    expect(commands[0]?.input).toBe(buffered[1]!.input)
    expect(commands[0]?.source).toBe(buffered[1]!.source)
    if (outcome === 'mismatch') {
      expect(commands[1]?.input).toBe(current.input)
      expect(commands[1]?.source).toBe(current.source)
    }
    expect(dispatcher.pending()).toBeNull()
    vi.advanceTimersByTime(100)
    expect(replayed).toHaveLength(buffered.length)
    expect(commands).toHaveLength(outcome === 'mismatch' ? 2 : 1)
  },
)

test.each(['timeout', 'mismatch'] as const)(
  'replays a buffered prefix whose command became unavailable before %s',
  (outcome) => {
    vi.useFakeTimers()
    let available = true
    const replayed: Stroke[] = []
    const command = vi.fn()
    dispatcher = createDispatcher<Source>({
      platform: 'linux',
      timeoutMs: 25,
      keymap: [
        { keys: 'G H', command: 'prefix' },
        { keys: 'G H I', command: 'long' },
      ],
      isAvailable: () => available,
      replay: (input, source) => replayed.push({ input, source }),
    })
    dispatcher.createNode({ commands: { prefix: command, long: command } }).focus()
    const buffered = [stroke('g'), stroke('h')]
    for (const entry of buffered) dispatcher.handleKey(entry.input, entry.source)
    available = false

    if (outcome === 'timeout') vi.advanceTimersByTime(25)
    else {
      const current = stroke('x')
      expect(dispatcher.handleKey(current.input, current.source)).toBe(false)
    }

    expect(command).not.toHaveBeenCalled()
    expect(replayed).toHaveLength(buffered.length)
    for (const [index, entry] of buffered.entries()) {
      expect(replayed[index]?.input).toBe(entry.input)
      expect(replayed[index]?.source).toBe(entry.source)
    }
    expect(dispatcher.pending()).toBeNull()
  },
)

test.each(['timeout', 'mismatch'] as const)(
  'does not replay a prefix claimed by a later candidate on %s',
  (outcome) => {
    vi.useFakeTimers()
    const calls: string[] = []
    const replayed: Stroke[] = []
    dispatcher = createDispatcher<Source>({
      platform: 'linux',
      timeoutMs: 25,
      keymap: [
        { keys: 'G H', command: 'fallback' },
        { keys: 'G H', command: 'decline' },
        { keys: 'G H I J', command: 'long' },
      ],
      replay: (input, source) => replayed.push({ input, source }),
    })
    dispatcher
      .createNode({
        commands: {
          decline: () => {
            calls.push('decline')
            return false
          },
          fallback: () => void calls.push('fallback'),
        },
      })
      .focus()
    const buffered = [stroke('g'), stroke('h'), stroke('i')]
    for (const entry of buffered) dispatcher.handleKey(entry.input, entry.source)

    if (outcome === 'timeout') vi.advanceTimersByTime(25)
    else {
      const current = stroke('x')
      expect(dispatcher.handleKey(current.input, current.source)).toBe(false)
    }

    expect(calls).toEqual(['decline', 'fallback'])
    expect(replayed).toHaveLength(1)
    expect(replayed[0]?.input).toBe(buffered[2]!.input)
    expect(replayed[0]?.source).toBe(buffered[2]!.source)
    expect(dispatcher.pending()).toBeNull()
  },
)

test('a declined completion replays earlier strokes and leaves the current stroke to its host', () => {
  const replayed: Stroke[] = []
  const command = vi.fn(() => false)
  dispatcher = createDispatcher<Source>({
    platform: 'linux',
    keymap: [{ keys: 'G H I', command: 'decline' }],
    replay: (input, source) => replayed.push({ input, source }),
  })
  dispatcher.createNode({ commands: { decline: command } }).focus()
  const buffered = [stroke('g'), stroke('h')]
  const current = stroke('i')
  for (const entry of buffered) {
    expect(dispatcher.handleKey(entry.input, entry.source)).toBe(true)
  }

  expect(dispatcher.handleKey(current.input, current.source)).toBe(false)

  expect(command).toHaveBeenCalledOnce()
  expect(command.mock.calls[0]).toEqual([
    expect.objectContaining({ input: current.input, source: current.source }),
  ])
  expect(replayed).toHaveLength(buffered.length)
  for (const [index, entry] of buffered.entries()) {
    expect(replayed[index]?.input).toBe(entry.input)
    expect(replayed[index]?.source).toBe(entry.source)
  }
  expect(dispatcher.pending()).toBeNull()
})
