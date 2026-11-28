import { expect, expectTypeOf, it, vi } from 'vitest'
import {
  compileKeymap,
  createBrowserDispatcher,
  createDispatcher,
  createKeyInput,
  explainKeymap,
} from '../../src/index.js'
import type { KeymapEntry } from '../../src/index.js'

it.each(['Mod+', 'Control+Shift+', 'Mdo+S', '[KeyS', 'Control+Shift', ''])(
  'rejects invalid keymap text %j without cancelling the active chord',
  (keys) => {
    using dispatcher = createDispatcher({ keymap: [{ keys: 'K C', command: 'old' }] })
    const command = vi.fn()
    dispatcher.createNode({ commands: { old: command } }).focus()
    dispatcher.handleKey(createKeyInput({ key: 'K' }), null)
    const pending = dispatcher.pending()
    expect(pending).not.toBeNull()
    const bad = [{ keys, command: 'bad' }]
    expect(() => compileKeymap(bad, 'linux')).toThrow(/entry 0, stroke 0, token/)
    expect(() => dispatcher.setKeymap(bad)).toThrow(/entry 0, stroke 0, token/)
    expect(dispatcher.pending()).toBe(pending)
    expect(dispatcher.handleKey(createKeyInput({ key: 'C' }), null)).toBe(true)
    expect(command).toHaveBeenCalledOnce()
  },
)

it('resolves across matching edges when the earlier edge is ineligible', () => {
  using dispatcher = createDispatcher({
    platform: 'linux',
    keymap: [
      { keys: 'Control+A', command: 'terminal', context: 'Terminal' },
      { keys: 'Control+[KeyQ]', command: 'editor', context: 'Editor' },
    ],
  })
  const editor = vi.fn()
  const terminal = vi.fn()
  dispatcher.createNode({ context: 'Editor', commands: { editor, terminal } }).focus()
  const input = createKeyInput({ key: 'a', code: 'KeyQ', modifiers: { ctrl: true } })
  expect(dispatcher.explain([input]).active.map(({ command }) => command)).toEqual(['editor'])
  expect(dispatcher.handleKey(input, null)).toBe(true)
  expect(editor).toHaveBeenCalledOnce()
  expect(terminal).not.toHaveBeenCalled()
})

it('uses the whole subtree when checking prefix reachability', () => {
  const entries = [
    { keys: 'K C', command: 'comment' },
    { keys: 'K', command: 'quick' },
    { keys: 'K X', command: 'close' },
  ] satisfies KeymapEntry[]
  const shadowed = explainKeymap(compileKeymap(entries.slice(0, 2), 'linux'), 'K C')
  expect(shadowed.blockedByPrefix).toMatchObject({
    kind: 'shadowed-by-prefix',
    strokeIndex: 0,
    winningBinding: { command: 'quick' },
  })
  expect(shadowed.active).toEqual([])
  expect(shadowed.candidates[0]).toMatchObject({ status: 'shadowed-by-prefix', blockedByIndex: 1 })
  expect(explainKeymap(compileKeymap(entries, 'linux'), 'K C').active[0]?.command).toBe('comment')
  expect(
    explainKeymap(compileKeymap(entries.slice(0, 2).toReversed(), 'linux'), 'K C').active[0]
      ?.command,
  ).toBe('comment')
})

it('reports shadowing at intermediate continuation nodes', () => {
  const keymap = compileKeymap(
    [
      { keys: 'K C X', command: 'long' },
      { keys: 'K C', command: 'short' },
    ],
    'linux',
  )
  expect(explainKeymap(keymap, 'K C X').blockedByPrefix).toMatchObject({
    kind: 'shadowed-by-prefix',
    strokeIndex: 1,
    winningBinding: { command: 'short' },
  })
  expect(explainKeymap(keymap, 'K').continuations).toMatchObject([
    { binding: { command: 'long' }, status: 'shadowed-by-prefix', shadowedByIndex: 1 },
    { binding: { command: 'short' }, status: 'pending' },
  ])
})

it('checks availability per source and keeps missing sources explicit', () => {
  using dispatcher = createDispatcher<boolean>({
    keymap: [{ keys: 'K C', command: 'chord' }],
    isAvailable: (_binding, allowed) => allowed,
  })
  expect(dispatcher.explain('K C', { sources: [true, false] }).candidates[0]?.status).toBe(
    'unavailable',
  )
  expect(dispatcher.explain('K C', { sources: [false, true] }).blockedByPrefix).toMatchObject({
    kind: 'prefix-unavailable',
    strokeIndex: 0,
    availability: 'known',
  })
  expect(dispatcher.explain('K C', { source: true }).candidates[0]?.status).toBe(
    'availability-unknown',
  )
})

it('ignores non-strokes without interrupting the pending chord query', () => {
  using dispatcher = createDispatcher({
    keymap: [
      { keys: 'K C', command: 'chord' },
      { keys: 'F1', command: 'help' },
    ],
  })
  const key = (value: string, rest: Partial<Parameters<typeof createKeyInput>[0]> = {}) =>
    createKeyInput({ key: value, ...rest })
  expect(dispatcher.explain([key('K', { type: 'keyup' })]).ignored?.reason).toBe('keyup')
  expect(dispatcher.explain([key('K', { composing: true })]).ignored?.reason).toBe('composing')
  expect(dispatcher.explain([key('Shift')]).ignored?.reason).toBe('modifier-only')
  expect(dispatcher.explain([key('K', { repeat: true })]).ignored?.reason).toBe(
    'repeat-on-chord-prefix',
  )
  expect(dispatcher.explain([key('F1', { repeat: true })]).active[0]?.command).toBe('help')
  expect(
    dispatcher.explain([
      key('K'),
      key('K', { repeat: true }),
      key('Shift'),
      key('K', { type: 'keyup' }),
      key('C'),
    ]).active[0]?.command,
  ).toBe('chord')
})

it('does not deliver stale pending labels after a listener cancels', () => {
  using dispatcher = createDispatcher({ keymap: [{ keys: 'K C', command: 'chord' }] })
  const labels: Array<string | null> = []
  dispatcher.subscribePending((label) => {
    if (!label) return
    expect(dispatcher.pending()).toBe(label)
    dispatcher.cancel()
  })
  dispatcher.subscribePending((label) => labels.push(label?.keys ?? null))
  dispatcher.handleKey(createKeyInput({ key: 'K' }), null)
  expect(labels).toEqual([null])
})

it('keeps host calls typed while an embedded node can decline a conflicting command', () => {
  type Commands = { select: { index: number }; reset: void }
  using dispatcher = createBrowserDispatcher<Commands>({ root: document })
  const handled = vi.fn()
  const host = dispatcher.createNode()
  host.handle('select', (event) => {
    expectTypeOf(event.args).toEqualTypeOf<{ index: number }>()
    handled(event.args.index)
  })
  const hosted = dispatcher.asHosted()
  const widget = hosted.createNode({ parent: host })
  widget.handle('select', ({ args }) => {
    expectTypeOf(args).toBeUnknown()
    return typeof args === 'string'
  })
  widget.focus()
  expect(dispatcher.dispatchCommand('select', { index: 2 })).toBe(true)
  expect(handled).toHaveBeenCalledWith(2)

  const checkInvalidCalls = () => {
    // @ts-expect-error Command names must be declared by the host.
    dispatcher.dispatchCommand('unknown')
    // @ts-expect-error Required payloads cannot be omitted.
    dispatcher.dispatchCommand('select')
    // @ts-expect-error The payload type is selected by the command name.
    dispatcher.dispatchCommandFrom(host, 'select', { index: 'wrong' })
    // @ts-expect-error Handler payloads must match the command.
    host.handle('select', ({ args }: { args: string }) => !!args)
  }
  expectTypeOf(checkInvalidCalls).toBeFunction()
})
