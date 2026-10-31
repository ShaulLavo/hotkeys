import { afterEach, expect, test, vi } from 'vitest'
import { createChordRuntime, createKeyInput } from '../../src/index.js'
import type { ChordRuntime, KeyInput, KeymapBinding } from '../../src/index.js'

type Source = { readonly key: string }
let runtime: ChordRuntime<string, Source> | undefined

afterEach(() => {
  runtime?.dispose()
  runtime = undefined
  vi.useRealTimers()
})

const ambiguous: readonly KeymapBinding<string>[] = [
  { chord: ['G', 'H'], payload: 'prefix' },
  { chord: ['G', 'H', 'I'], payload: 'longer' },
]

function setup(
  bindings = ambiguous,
  dispatch = vi.fn((_binding: KeymapBinding<string>) => false),
  currentFocus?: () => unknown,
) {
  const replay = vi.fn<(input: KeyInput, source: Source) => void>()
  let available = true
  runtime = createChordRuntime({
    platform: 'linux',
    bindings,
    timeoutMs: 25,
    captureContext: () => null,
    isAvailable: () => available,
    dispatch,
    currentFocus,
    effects: { preventDefault: () => {}, stopPropagation: () => {}, swallow: () => {} },
    replay,
  })
  const press = (key: string) => {
    const input = createKeyInput({ key, code: `Key${key.toUpperCase()}` })
    const source = { key }
    const owned = runtime!.handleKey(input, source)
    return { input, source, owned }
  }
  return {
    press,
    replay,
    dispatch,
    setAvailable: (next: boolean) => {
      available = next
    },
  }
}

test.each(['timeout', 'mismatch'] as const)(
  'replays every declined multi-stroke prefix input and its original source on %s',
  (reason) => {
    vi.useFakeTimers()
    const h = setup()
    const first = h.press('g')
    const second = h.press('h')
    expect(first.owned).toBe(true)
    expect(second.owned).toBe(true)

    if (reason === 'timeout') vi.advanceTimersByTime(25)
    else expect(h.press('x').owned).toBe(false)

    expect(h.dispatch.mock.calls.map(([binding]) => binding.payload)).toEqual(['prefix'])
    expect(h.replay).toHaveBeenCalledTimes(2)
    expect(h.replay.mock.calls[0]![0]).toBe(first.input)
    expect(h.replay.mock.calls[0]![1]).toBe(first.source)
    expect(h.replay.mock.calls[1]![0]).toBe(second.input)
    expect(h.replay.mock.calls[1]![1]).toBe(second.source)
    expect(runtime!.pending()).toBeNull()
    vi.advanceTimersByTime(100)
    expect(h.replay).toHaveBeenCalledTimes(2)
  },
)

test('tries every candidate once and replays a declined prefix without rerunning shorter bindings', () => {
  vi.useFakeTimers()
  const h = setup([
    { chord: ['G'], payload: 'shorter' },
    { chord: ['H'], payload: 'suffix' },
    { chord: ['G', 'H'], payload: 'first' },
    { chord: ['G', 'H'], payload: 'second' },
    { chord: ['G', 'H', 'I'], payload: 'longer' },
  ])
  h.press('g')
  h.press('h')
  vi.advanceTimersByTime(25)

  expect(h.dispatch.mock.calls.map(([binding]) => binding.payload)).toEqual(['first', 'second'])
  expect(h.replay.mock.calls.map(([input]) => input.key)).toEqual(['G', 'H'])
})

test('keeps the unattempted suffix available for a chord with the mismatching key', () => {
  const dispatch = vi.fn((binding: KeymapBinding<string>) => binding.payload === 'resumed')
  const h = setup(
    [
      { chord: ['G', 'H'], payload: 'prefix' },
      { chord: ['G', 'H', 'J', 'L'], payload: 'longer' },
      { chord: ['J', 'K'], payload: 'resumed' },
    ],
    dispatch,
  )
  h.press('g')
  h.press('h')
  h.press('j')
  expect(h.press('k').owned).toBe(true)

  expect(dispatch.mock.calls.map(([binding]) => binding.payload)).toEqual(['prefix', 'resumed'])
  expect(h.replay.mock.calls.map(([input]) => input.key)).toEqual(['G', 'H'])
  expect(runtime!.pending()).toBeNull()
})

test.each(['timeout', 'mismatch'] as const)(
  'replays all buffered keys when their bindings become unavailable before %s',
  (reason) => {
    vi.useFakeTimers()
    const h = setup()
    h.press('g')
    h.press('h')
    h.setAvailable(false)
    if (reason === 'timeout') vi.advanceTimersByTime(25)
    else expect(h.press('x').owned).toBe(false)

    expect(h.dispatch).not.toHaveBeenCalled()
    expect(h.replay.mock.calls.map(([input]) => input.key)).toEqual(['G', 'H'])
  },
)

test('a later candidate claiming the prefix prevents replay of all its strokes', () => {
  vi.useFakeTimers()
  const dispatch = vi.fn((binding: KeymapBinding<string>) => binding.payload === 'accepted')
  const h = setup(
    [
      { chord: ['G', 'H'], payload: 'declined' },
      { chord: ['G', 'H'], payload: 'accepted' },
      { chord: ['G', 'H', 'I'], payload: 'longer' },
    ],
    dispatch,
  )
  h.press('g')
  h.press('h')
  vi.advanceTimersByTime(25)

  expect(dispatch.mock.calls.map(([binding]) => binding.payload)).toEqual(['declined', 'accepted'])
  expect(h.replay).not.toHaveBeenCalled()
})

test.each(['preventDefault', 'stopPropagation'] as const)(
  'explicit %s retains a declined buffered prefix without replay',
  (option) => {
    vi.useFakeTimers()
    const h = setup([{ chord: ['G', 'H'], payload: 'prefix', [option]: true }, ambiguous[1]!])
    h.press('g')
    h.press('h')
    vi.advanceTimersByTime(25)

    expect(h.dispatch).toHaveBeenCalledOnce()
    expect(h.replay).not.toHaveBeenCalled()
  },
)

test('a declined completion replays earlier buffered strokes and lets the current key pass', () => {
  const h = setup([{ chord: ['G', 'H', 'I'], payload: 'chord' }])
  h.press('g')
  h.press('h')
  expect(h.press('i').owned).toBe(false)

  expect(h.dispatch).toHaveBeenCalledOnce()
  expect(h.replay.mock.calls.map(([input]) => input.key)).toEqual(['G', 'H'])
  expect(runtime!.pending()).toBeNull()
})

test.each(['preventDefault', 'stopPropagation'] as const)(
  'explicit %s retains a declined completion without replay',
  (option) => {
    const h = setup([{ chord: ['G', 'H'], payload: 'chord', [option]: true }])
    h.press('g')
    expect(h.press('h').owned).toBe(true)
    expect(h.replay).not.toHaveBeenCalled()
    expect(runtime!.pending()).toBeNull()
  },
)

test.each(['cancel', 'dispose'] as const)(
  '%s during a declining completion discards the pending input',
  (action) => {
    const dispatch = vi.fn((_binding: KeymapBinding<string>) => {
      runtime![action]()
      return false
    })
    const h = setup([{ chord: ['G', 'H'], payload: 'chord' }], dispatch)
    h.press('g')
    h.press('h')
    expect(h.replay).not.toHaveBeenCalled()
    expect(runtime!.pending()).toBeNull()
  },
)

test('a declining completion that moves focus discards its old buffered input', () => {
  let focus = 'first'
  const dispatch = vi.fn((_binding: KeymapBinding<string>) => {
    focus = 'second'
    return false
  })
  const h = setup([{ chord: ['G', 'H'], payload: 'chord' }], dispatch, () => focus)
  h.press('g')
  expect(h.press('h').owned).toBe(false)
  expect(h.replay).not.toHaveBeenCalled()
  expect(runtime!.pending()).toBeNull()
})
