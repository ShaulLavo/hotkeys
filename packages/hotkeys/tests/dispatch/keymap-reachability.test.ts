import { describe, expect, it } from 'vitest'
import {
  bindingsForInput,
  compileKeymap,
  createDispatcher,
  createKeyInput,
  parseKeyContext,
  resolveKeymapNode,
  trieStep,
} from '../../src'
import type { BindingSource, CompiledBinding, CompiledKeymap, KeymapEntry } from '../../src'

const context = ['Workspace', 'Editor'].map(parseKeyContext)
const keys = ['K', 'C'].map((key) => createKeyInput({ key, code: `Key${key}` }))

function expectReachable(entries: readonly KeymapEntry[], commands: readonly string[]) {
  const keymap = compileKeymap(entries, 'linux')
  const complete = bindingsForInput(keymap, keys, context)
  expect(complete.bindings.map((binding) => binding.command)).toEqual(commands)
  expect(complete.pending).toBe(false)
  expect(bindingsForInput(keymap, keys.slice(0, 1), context).pending).toBe(commands.length > 0)
}

function selectPrefix(keymap: CompiledKeymap, isAvailable?: (binding: CompiledBinding) => boolean) {
  const prefix = trieStep(keymap.root, keys[0]!)!.node
  return resolveKeymapNode(prefix, context, isAvailable)
}

function removal(
  kind: 'null' | 'unbind',
  source: BindingSource = 'user',
  predicate?: string,
): KeymapEntry {
  return kind === 'null'
    ? { keys: 'K C', command: null, source, context: predicate }
    : { keys: 'K C', unbind: 'one', source, context: predicate }
}

describe.each(['null', 'unbind'] as const)('%s removal precedence for pending chords', (kind) => {
  it.each([
    ['user', 'default'],
    ['pack', 'base'],
  ] as const)('respects %s over %s in either table order', (stronger, weaker) => {
    const strongBinding: KeymapEntry = { keys: 'K C', command: 'one', source: stronger }
    const weakRemoval = removal(kind, weaker)
    expectReachable([strongBinding, weakRemoval], ['one'])
    expectReachable([weakRemoval, strongBinding], ['one'])

    const weakBinding: KeymapEntry = { keys: 'K C', command: 'one', source: weaker }
    const strongRemoval = removal(kind, stronger)
    expectReachable([weakBinding, strongRemoval], [])
    expectReachable([strongRemoval, weakBinding], [])
  })

  it('uses later table entries when context and source tie', () => {
    const binding: KeymapEntry = { keys: 'K C', command: 'one', source: 'user' }
    const unbinding = removal(kind)
    expectReachable([binding, unbinding], [])
    expectReachable([unbinding, binding], ['one'])
  })

  it.each([
    { bindingContext: 'Editor', removalContext: 'Workspace', survives: true },
    { bindingContext: 'Workspace', removalContext: 'Editor', survives: false },
    { bindingContext: 'Editor', removalContext: 'Terminal', survives: true },
  ])(
    'matches complete resolution for a $bindingContext binding and $removalContext removal',
    ({ bindingContext, removalContext, survives }) => {
      const binding: KeymapEntry = { keys: 'K C', command: 'one', context: bindingContext }
      const unbinding = removal(kind, 'user', removalContext)
      const commands = survives ? ['one'] : []
      expectReachable([binding, unbinding], commands)
      expectReachable([unbinding, binding], commands)
    },
  )

  it('applies an earlier removal before the exact-prefix cutoff', () => {
    const keymap = compileKeymap(
      [
        removal(kind),
        { keys: 'K', command: 'short' },
        { keys: 'K C', command: 'one', source: 'default' },
      ],
      'linux',
    )
    const prefix = selectPrefix(keymap)
    expect(prefix.bindings.map((binding) => binding.payload.command)).toEqual(['short'])
    expect(prefix.pending).toBe(0)
    expect(bindingsForInput(keymap, keys, context).bindings).toEqual([])
  })

  it('ignores an unavailable removal before deciding whether the prefix waits', () => {
    const keymap = compileKeymap(
      [{ keys: 'K C', command: 'one', source: 'default' }, removal(kind)],
      'linux',
    )
    expect(selectPrefix(keymap).pending).toBe(0)
    const available = (binding: CompiledBinding) => binding.command !== null
    expect(selectPrefix(keymap, available).pending).toBe(1)
    const prefix = trieStep(keymap.root, keys[0]!)!.node
    const complete = trieStep(prefix, keys[1]!)!.node
    expect(
      resolveKeymapNode(complete, context, available).bindings.map(
        (binding) => binding.payload.command,
      ),
    ).toEqual(['one'])
  })
})

describe('effective chord candidates', () => {
  const targeted: readonly KeymapEntry[] = [
    { keys: 'K C', command: 'one', source: 'default' },
    { keys: 'K C', command: 'two', source: 'default' },
    { keys: 'K C', unbind: 'two', source: 'user' },
  ]

  it('unbinding one command leaves another on the same chord reachable', () => {
    expectReachable(targeted, ['one'])
    expect(selectPrefix(compileKeymap(targeted, 'linux')).pending).toBe(1)
  })

  it('counts distinct continuation paths rather than the commands on each path', () => {
    const keymap = compileKeymap(
      [
        { keys: 'K C', command: 'one' },
        { keys: 'K C', command: 'two' },
        { keys: 'K X', command: 'other' },
      ],
      'linux',
    )
    expect(selectPrefix(keymap).pending).toBe(2)
  })

  it('does not count an unavailable surviving command', () => {
    const keymap = compileKeymap(targeted, 'linux')
    expect(selectPrefix(keymap, (binding) => binding.command !== 'one').pending).toBe(0)
    expect(selectPrefix(keymap, (binding) => binding.command !== 'two').pending).toBe(1)
  })

  it('a null removal for one continuation leaves a different continuation pending', () => {
    const keymap = compileKeymap(
      [
        { keys: 'K C', command: 'one' },
        { keys: 'K X', command: 'other' },
        { keys: 'K C', command: null },
      ],
      'linux',
    )
    expect(selectPrefix(keymap).pending).toBe(1)
  })

  it('a surviving command before the exact prefix does not keep it pending', () => {
    const keymap = compileKeymap(
      [
        { keys: 'K C', command: 'one', source: 'user' },
        { keys: 'K', command: 'short' },
        { keys: 'K C', command: 'two', source: 'default' },
        { keys: 'K C', unbind: 'two', source: 'user' },
      ],
      'linux',
    )
    expect(
      bindingsForInput(keymap, keys, context).bindings.map((binding) => binding.command),
    ).toEqual(['one'])
    expect(selectPrefix(keymap).pending).toBe(0)
  })

  it.each([
    {
      spelling: 'logical',
      first: 'Mod+K Mod+C',
      second: 'Control+K Control+C',
      unbind: 'ctrl+k ctrl+c',
    },
    {
      spelling: 'physical',
      first: 'Mod+[KeyK] Mod+[KeyC]',
      second: 'Control+[KeyK] Control+[KeyC]',
      unbind: 'ctrl+[KeyK] ctrl+[KeyC]',
    },
  ])(
    'resolves equivalent $spelling spellings at the same trie node',
    ({ first, second, unbind }) => {
      const keymap = compileKeymap(
        [
          { keys: first, command: 'one', source: 'default' },
          { keys: second, command: 'two', source: 'default' },
          { keys: unbind, unbind: 'two', source: 'user' },
        ],
        'linux',
      )
      const inputs = ['K', 'C'].map((key) =>
        createKeyInput({ key, code: `Key${key}`, modifiers: { ctrl: true } }),
      )
      expect(
        bindingsForInput(keymap, inputs, context).bindings.map((binding) => binding.command),
      ).toEqual(['one'])
      expect(bindingsForInput(keymap, inputs.slice(0, 1), context).pending).toBe(true)
    },
  )

  it.each([
    { name: 'a command-specific unbind', entries: targeted },
    {
      name: 'a weaker null removal',
      entries: [
        { keys: 'K C', command: 'one', source: 'user' },
        { keys: 'K C', command: null, source: 'default' },
      ] as const,
    },
  ])('live dispatch reaches the surviving command after $name', ({ entries }) => {
    const keymap = compileKeymap(entries, 'linux')
    expect(
      bindingsForInput(keymap, keys, context).bindings.map((binding) => binding.command),
    ).toEqual(['one'])
    const called: string[] = []
    const dispatcher = createDispatcher<null>({ keymap: entries, platform: 'linux' })
    dispatcher
      .createNode({
        commands: {
          one: () => {
            called.push('one')
          },
          two: () => {
            called.push('two')
          },
        },
      })
      .focus()
    try {
      expect(dispatcher.handleKey(keys[0]!, null)).toBe(true)
      expect(dispatcher.pending()?.candidateCount).toBe(1)
      expect(dispatcher.handleKey(keys[1]!, null)).toBe(true)
      expect(called).toEqual(['one'])
      expect(dispatcher.pending()).toBeNull()
    } finally {
      dispatcher.dispose()
    }
  })
})
