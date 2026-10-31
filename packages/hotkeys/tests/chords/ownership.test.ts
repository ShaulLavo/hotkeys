import { afterEach, expect, test, vi } from 'vitest'
import { createChordRuntime, createKeyInput } from '../../src/index.js'
import type {
  ChordRuntime,
  ChordRuntimeOptions,
  KeymapBinding,
  KeymapSequenceEvent,
  PendingChordLabel,
} from '../../src/index.js'

type Source = { readonly key: string }
type Options = ChordRuntimeOptions<string, null, Source>
type Hooks = Partial<Omit<Options, 'bindings' | 'platform'>>
let runtime: ChordRuntime<string, Source> | undefined

afterEach(() => {
  runtime?.dispose()
  runtime = undefined
  vi.useRealTimers()
})

const chords: readonly KeymapBinding<string>[] = [
  { chord: ['G', 'H'], payload: 'outer' },
  { chord: ['X', 'Y'], payload: 'nested' },
]
const ambiguous: readonly KeymapBinding<string>[] = [
  { chord: ['G', 'H'], payload: 'prefix' },
  { chord: ['G', 'H', 'I'], payload: 'longer' },
]

function setup(bindings: readonly KeymapBinding<string>[] = chords, hooks: Hooks = {}) {
  const calls: string[] = []
  const events: KeymapSequenceEvent<string>[] = []
  let visiblePending: PendingChordLabel | null = null
  const replay = vi.fn<NonNullable<Options['replay']>>((input, source) => {
    hooks.replay?.(input, source)
  })
  runtime = createChordRuntime({
    bindings,
    platform: 'linux',
    timeoutMs: 25,
    effects: hooks.effects ?? {
      preventDefault: () => {},
      stopPropagation: () => {},
      swallow: () => {},
    },
    captureContext: hooks.captureContext ?? (() => null),
    currentFocus: hooks.currentFocus,
    acceptsTextInput: hooks.acceptsTextInput,
    isAvailable: hooks.isAvailable,
    select: hooks.select,
    dispatch: (binding, context, source, input) => {
      calls.push(binding.payload)
      return hooks.dispatch?.(binding, context, source, input) ?? true
    },
    onCaptureChange: hooks.onCaptureChange,
    onPendingChange: (pending) => {
      visiblePending = pending
      hooks.onPendingChange?.(pending)
    },
    onSequence: (event) => {
      events.push(event)
      hooks.onSequence?.(event)
    },
    replay,
  })
  const instance = runtime
  const offer = (key: string, type: 'keydown' | 'keyup') =>
    instance.handleKey(createKeyInput({ key, code: `Key${key.toUpperCase()}`, type }), { key })
  return {
    runtime: instance,
    calls,
    events,
    replay,
    press: (key: string) => offer(key, 'keydown'),
    release: (key: string) => offer(key, 'keyup'),
    visiblePending: () => visiblePending,
  }
}

test('a nested single-key dispatch preserves the outer candidate fallback', () => {
  const h = setup(
    [
      { chord: ['G', 'H'], payload: 'first' },
      { chord: ['G', 'H'], payload: 'fallback' },
      { chord: ['X'], payload: 'nested' },
    ],
    {
      dispatch: ({ payload }) => {
        if (payload !== 'first') return true
        expect(h.press('x')).toBe(true)
        return false
      },
    },
  )
  h.press('g')
  expect(h.press('h')).toBe(true)

  expect(h.calls).toEqual(['first', 'nested', 'fallback'])
  expect(h.replay).not.toHaveBeenCalled()
  expect(h.events.map((event) => [event.keys, event.outcome, event.binding?.payload])).toEqual([
    ['G', 'completed', 'fallback'],
  ])
})

test.each(['before', 'after'] as const)(
  'cancellation %s a nested dispatch remains attached to the outer operation',
  (when) => {
    const h = setup(
      [
        { chord: ['G', 'H'], payload: 'outer' },
        { chord: ['G', 'H'], payload: 'fallback' },
        { chord: ['X'], payload: 'nested' },
      ],
      {
        dispatch: ({ payload }) => {
          if (payload !== 'outer') return true
          if (when === 'before') h.runtime.cancel()
          expect(h.press('x')).toBe(true)
          if (when === 'after') h.runtime.cancel()
          return false
        },
      },
    )
    h.press('g')
    expect(h.press('h')).toBe(true)
    expect(h.calls).toEqual(['outer', 'nested'])
    expect(h.replay).not.toHaveBeenCalled()
    expect(h.events.map((event) => event.outcome)).not.toContain('unmatched')
    expect(h.runtime.pending()).toBeNull()
  },
)

test('a caught nested exception restores the outer cancellation scope', () => {
  const failure = new Error('nested handler failed')
  const h = setup(
    [
      { chord: ['G', 'H'], payload: 'outer' },
      { chord: ['G', 'H'], payload: 'fallback' },
      { chord: ['X'], payload: 'nested' },
    ],
    {
      dispatch: ({ payload }) => {
        if (payload === 'nested') throw failure
        if (payload !== 'outer') return true
        expect(() => h.press('x')).toThrow(failure)
        h.runtime.cancel()
        return false
      },
    },
  )
  h.press('g')
  expect(h.press('h')).toBe(true)
  expect(h.calls).toEqual(['outer', 'nested'])
  expect(h.replay).not.toHaveBeenCalled()
  expect(h.events.map((event) => event.outcome)).not.toContain('unmatched')
})

test('a successful completion still reports completed once after cancelling itself', () => {
  const h = setup(chords, {
    dispatch: () => {
      h.runtime.cancel()
      return true
    },
  })
  h.press('g')
  expect(h.press('h')).toBe(true)
  expect(h.events.map((event) => [event.outcome, event.binding?.payload])).toEqual([
    ['completed', 'outer'],
  ])
  expect(h.replay).not.toHaveBeenCalled()
})

test.each(['swallow', 'captureContext', 'currentFocus', 'isAvailable'] as const)(
  'disposal from %s cannot arm a prefix or schedule later recovery',
  (callback) => {
    vi.useFakeTimers()
    let h: ReturnType<typeof setup>
    let hooks: Hooks
    if (callback === 'swallow') {
      hooks = {
        effects: {
          preventDefault: () => {},
          stopPropagation: () => {},
          swallow: () => h.runtime.dispose(),
        },
      }
    } else if (callback === 'captureContext') {
      hooks = {
        captureContext: () => {
          h.runtime.dispose()
          return null
        },
      }
    } else if (callback === 'currentFocus') {
      hooks = {
        currentFocus: () => {
          h.runtime.dispose()
          return 'target'
        },
      }
    } else {
      hooks = {
        isAvailable: () => {
          h.runtime.dispose()
          return true
        },
      }
    }
    h = setup(
      [
        { chord: ['G'], payload: 'prefix' },
        { chord: ['G', 'H'], payload: 'longer' },
      ],
      hooks,
    )
    expect(() => h.press('g')).not.toThrow()
    expect(h.runtime.pending()).toBeNull()
    expect(h.runtime.wantsCapture()).toBe(false)
    expect(h.visiblePending()).toBeNull()
    expect(h.press('h')).toBe(false)
    vi.advanceTimersByTime(100)
    expect(h.calls).toEqual([])
    expect(h.replay).not.toHaveBeenCalled()
    expect(h.events.map((event) => event.outcome)).not.toContain('timeout')
  },
)

test.each(['capture', 'pending'] as const)(
  'disposal from a %s notification leaves no pending state or stale hint',
  (notification) => {
    vi.useFakeTimers()
    const disposePending = () => {
      if (h.runtime.pending()) h.runtime.dispose()
    }
    const h = setup(
      [
        { chord: ['G'], payload: 'prefix' },
        { chord: ['G', 'H'], payload: 'longer' },
      ],
      notification === 'capture'
        ? { onCaptureChange: disposePending }
        : { onPendingChange: disposePending },
    )
    h.press('g')
    expect(h.runtime.pending()).toBeNull()
    expect(h.visiblePending()).toBeNull()
    vi.advanceTimersByTime(100)
    expect(h.calls).toEqual([])
    expect(h.replay).not.toHaveBeenCalled()
  },
)

test('disposal from the mismatch report prevents fresh matching of the current key', () => {
  const h = setup(chords, {
    onSequence: () => h.runtime.dispose(),
  })
  h.press('g')
  h.press('x')
  expect(h.runtime.pending()).toBeNull()
  expect(h.visiblePending()).toBeNull()
  expect(h.calls).toEqual([])
  expect(h.replay.mock.calls.map(([input]) => input.key)).toEqual(['G'])
  expect(h.press('y')).toBe(false)
})

test.each(['capture', 'pending'] as const)(
  'nested completion from a %s notification cannot publish a stale prefix label',
  (notification) => {
    let reentered = false
    const complete = () => {
      if (reentered || h.runtime.pending()?.keys !== 'G') return
      reentered = true
      expect(h.press('h')).toBe(true)
      expect(h.press('x')).toBe(true)
    }
    const h = setup(
      chords,
      notification === 'capture' ? { onCaptureChange: complete } : { onPendingChange: complete },
    )
    h.press('g')
    expect(h.calls).toEqual(['outer'])
    expect(h.runtime.pending()?.keys).toBe('X')
    expect(h.visiblePending()).toEqual(h.runtime.pending())
    expect(h.press('y')).toBe(true)
    expect(h.calls).toEqual(['outer', 'nested'])
    expect(h.visiblePending()).toBeNull()
  },
)

test('a prefix started by the clear notification survives the outer completion', () => {
  let started = false
  const h = setup(chords, {
    onPendingChange: (pending) => {
      if (pending || started) return
      started = true
      h.press('x')
    },
  })
  h.press('g')
  expect(h.press('h')).toBe(true)
  expect(h.runtime.pending()?.keys).toBe('X')
  expect(h.events.map((event) => [event.keys, event.outcome, event.binding?.payload])).toEqual([
    ['G', 'completed', 'outer'],
  ])
  expect(h.press('y')).toBe(true)
  expect(h.calls).toEqual(['outer', 'nested'])
})

test.each(['currentFocus', 'captureContext'] as const)(
  'disposal while reading %s for a continuation cannot dereference cleared pending state',
  (callback) => {
    let destroyOnRead = false
    const read = () => {
      if (destroyOnRead) h.runtime.dispose()
      return null
    }
    const h = setup(chords, { [callback]: read })
    h.press('g')
    destroyOnRead = true
    expect(() => h.press('h')).not.toThrow()
    expect(h.runtime.pending()).toBeNull()
    expect(h.calls).toEqual([])
    expect(h.replay).not.toHaveBeenCalled()
  },
)

test('releaseAll in a completion handler prevents its held claim from being restored', () => {
  const h = setup(chords, {
    dispatch: () => {
      h.runtime.releaseAll()
      return true
    },
  })
  h.press('g')
  expect(h.press('h')).toBe(true)
  expect(h.runtime.pending()).toBeNull()
  expect(h.runtime.wantsCapture()).toBe(false)
  expect(h.release('g')).toBe(false)
  expect(h.release('h')).toBe(false)
})

test.each([
  { releasedKey: 'h', completingKeyHeld: false },
  { releasedKey: 'x', completingKeyHeld: true },
])(
  'a nested $releasedKey release only retires the matching in-flight key',
  ({ releasedKey, completingKeyHeld }) => {
    const h = setup(chords, {
      dispatch: () => {
        h.release(releasedKey)
        return true
      },
    })
    h.press('g')
    h.release('g')
    expect(h.press('h')).toBe(true)
    expect(h.runtime.wantsCapture()).toBe(completingKeyHeld)
    expect(h.release('h')).toBe(completingKeyHeld)
    expect(h.runtime.wantsCapture()).toBe(false)
  },
)

test('nested pending input during replay preserves both the new chord and the old buffer', () => {
  vi.useFakeTimers()
  const h = setup(ambiguous.concat([chords[1]!]), {
    dispatch: ({ payload }) => payload === 'nested',
    replay: (input) => {
      if (input.key === 'G') h.press('x')
    },
  })
  h.press('g')
  h.press('h')
  vi.advanceTimersByTime(25)
  expect(h.replay.mock.calls.map(([input]) => input.key)).toEqual(['G', 'H'])
  expect(h.calls).toEqual(['prefix'])
  expect(h.runtime.pending()?.keys).toBe('X')
  expect(h.visiblePending()).toEqual(h.runtime.pending())
  expect(h.press('y')).toBe(true)
  expect(h.calls).toEqual(['prefix', 'nested'])
})

test.each(['pending', 'completed'] as const)(
  'nested %s input during recovery prevents a fresh match of the older current key',
  (state) => {
    const h = setup(chords.concat([{ chord: ['Q'], payload: 'stale' }]), {
      replay: (input) => {
        if (input.key !== 'G') return
        h.press('x')
        if (state === 'completed') h.press('y')
      },
    })
    h.press('g')
    expect(h.press('q')).toBe(false)
    expect(h.calls).toEqual(state === 'completed' ? ['nested'] : [])
    expect(h.replay.mock.calls.map(([input]) => input.key)).toEqual(['G'])
    expect(h.runtime.pending()?.keys ?? null).toBe(state === 'completed' ? null : 'X')
  },
)

test('a nested chord that starts and completes prevents stale suffix resumption', () => {
  const h = setup(
    [
      { chord: ['G'], payload: 'prefix' },
      { chord: ['G', 'H', 'J', 'L'], payload: 'longer' },
      { chord: ['H', 'J', 'K'], payload: 'stale' },
      chords[1]!,
    ],
    {
      dispatch: ({ payload }) => payload !== 'prefix',
      replay: (input) => {
        if (input.key !== 'G') return
        h.press('x')
        h.press('y')
      },
    },
  )
  h.press('g')
  h.press('h')
  h.press('j')
  expect(h.press('k')).toBe(false)
  expect(h.calls).toEqual(['prefix', 'nested'])
  expect(h.replay.mock.calls.map(([input]) => input.key)).toEqual(['G', 'H', 'J'])
  expect(h.runtime.pending()).toBeNull()
})

test('replacement notifications see the new keymap and can start a chord from it', () => {
  let replacing = false
  const h = setup([chords[0]!, { chord: ['X'], payload: 'old' }], {
    onPendingChange: (pending) => {
      if (pending || !replacing) return
      replacing = false
      h.press('x')
    },
  })
  h.press('g')
  replacing = true
  h.runtime.updateBindings([chords[1]!])
  expect(h.calls).toEqual([])
  expect(h.runtime.pending()?.keys).toBe('X')
  expect(h.press('y')).toBe(true)
  expect(h.calls).toEqual(['nested'])
})

test('a keymap replacement from a sequence notification is not overwritten by its caller', () => {
  let replacing = false
  const h = setup(chords, {
    onSequence: () => {
      if (!replacing) return
      replacing = false
      h.runtime.updateBindings([{ chord: ['X'], payload: 'latest' }])
    },
  })
  h.press('g')
  replacing = true
  h.runtime.updateBindings([{ chord: ['X'], payload: 'obsolete' }])
  expect(h.press('x')).toBe(true)
  expect(h.calls).toEqual(['latest'])
})

test.each(['timeout', 'mismatch'] as const)(
  'disposal from replay interrupts %s recovery before later keys or its nominal report',
  (reason) => {
    vi.useFakeTimers()
    const h = setup(ambiguous, {
      dispatch: () => false,
      replay: () => h.runtime.dispose(),
    })
    h.press('g')
    h.press('h')
    if (reason === 'timeout') vi.advanceTimersByTime(25)
    else h.press('q')
    expect(h.replay.mock.calls.map(([input]) => input.key)).toEqual(['G'])
    expect(h.events.map((event) => event.outcome)).not.toContain(
      reason === 'timeout' ? 'timeout' : 'unmatched',
    )
    expect(h.runtime.pending()).toBeNull()
    expect(h.runtime.wantsCapture()).toBe(false)
  },
)
