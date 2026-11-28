import { StrictMode, createRef, useLayoutEffect } from 'react'
import { act, fireEvent, render, renderHook } from '@testing-library/react'
import { expect, expectTypeOf, it, vi } from 'vitest'
import { createBrowserDispatcher, createHotkeyRegistry, parseShortcut } from '../../src/index.js'
import type { BrowserDispatcher, KeymapEntry } from '../../src/index.js'
import {
  createHotkeysContext,
  FocusScope,
  HotkeysProvider,
  useFocusNode,
  useHotkeys,
  useHotkey,
  useHotkeyRegistrations,
  useKeyHold,
  usePendingChord,
} from '../../src/react/index.js'
import type { UseHotkeyDefinition } from '../../src/react/index.js'

type Commands = { workspace: void; editor: { index: number }; commit: void }
const App = createHotkeysContext<Commands>()
const bindings = [
  { keys: 'Mod+B', command: 'workspace', context: 'Workspace' },
  { keys: 'Mod+B', command: 'editor', args: { index: 2 }, context: 'Editor' },
  { keys: 'Mod+K Mod+C', command: 'commit', context: 'Workspace' },
] as const satisfies readonly KeymapEntry<Commands>[]

function press(target: Element | Document, key: string, modifiers: KeyboardEventInit = {}) {
  fireEvent.keyDown(target, {
    key,
    code: `Key${key.toUpperCase()}`,
    cancelable: true,
    ...modifiers,
  })
  fireEvent.keyUp(target, { key, code: `Key${key.toUpperCase()}`, cancelable: true, ...modifiers })
}

it('routes nested nodes and merges independent registrations on one element in Strict Mode', () => {
  const calls: string[] = []
  let lastDispatcher: BrowserDispatcher<Commands> | null = null
  function Editor({ label }: { label: string }) {
    const target = createRef<HTMLTextAreaElement>()
    const first = App.useFocusNode({ context: 'Editor', target })
    const second = App.useFocusNode({
      target,
      context: () => ({ identifiers: ['Editable'] }),
      commands: { editor: ({ args }) => void calls.push(`${label} ${args.index}`) },
    })
    const dispatcher = App.useHotkeysDispatcher()
    useLayoutEffect(() => {
      lastDispatcher = dispatcher
    }, [dispatcher])
    return (
      <textarea
        aria-label='Editor'
        ref={target}
        data-shared={first.node !== null && first.node === second.node}
      />
    )
  }

  function Workspace({
    label,
    keymap,
  }: {
    label: string
    keymap: typeof bindings | readonly KeymapEntry<Commands>[]
  }) {
    const pending = App.usePendingChord()
    return (
      <App.FocusScope
        context='Workspace'
        commands={{
          workspace: () => void calls.push('workspace'),
          commit: () => void calls.push('commit'),
        }}
      >
        <button>Workspace</button>
        <Editor label={label} />
        <output>{pending?.keys ?? ''}</output>
        <i>{keymap.length}</i>
      </App.FocusScope>
    )
  }

  function Root({
    label,
    keymap = bindings,
  }: {
    label: string
    keymap?: readonly KeymapEntry<Commands>[]
  }) {
    return (
      <StrictMode>
        <App.HotkeysProvider platform='linux' keymap={keymap}>
          <Workspace label={label} keymap={keymap} />
        </App.HotkeysProvider>
      </StrictMode>
    )
  }

  const view = render(<Root label='editor' />)
  const editor = view.getByRole('textbox')
  const button = view.getByRole('button')
  expect(editor.getAttribute('data-shared')).toBe('true')
  const instance = lastDispatcher!
  const node = instance.nodeForElement(editor)
  press(button, 'b', { ctrlKey: true })
  press(editor, 'b', { ctrlKey: true })
  expect(calls).toEqual(['workspace', 'editor 2'])
  expect(instance.contextStack().at(-1)?.identifiers).toEqual(new Set(['Editor', 'Editable']))

  view.rerender(<Root keymap={bindings.slice()} label='updated' />)
  expect(lastDispatcher).toBe(instance)
  expect(instance.nodeForElement(editor)).toBe(node)
  press(editor, 'b', { ctrlKey: true })
  expect(calls.at(-1)).toBe('updated 2')
  press(button, 'k', { ctrlKey: true })
  expect(view.getByRole('status').textContent).toBe('Control+K')
  press(button, 'c', { ctrlKey: true })
  expect(calls.at(-1)).toBe('commit')
  expect(view.getByRole('status').textContent).toBe('')
  view.unmount()
  expect(instance.nodeForElement(editor)).toBeNull()
  press(button, 'b', { ctrlKey: true })
  expect(calls).toHaveLength(4)
})

it('subscribes to already-pending external dispatchers and releases their nodes on swap', () => {
  using first = createBrowserDispatcher({ keymap: [{ keys: 'K C', command: 'go' }] })
  using second = createBrowserDispatcher({ keymap: [{ keys: 'K X', command: 'go' }] })
  press(document, 'k')
  const click = vi.fn()
  function Child() {
    const pending = usePendingChord()
    return (
      <FocusScope commands={{ go: click }}>
        <button>{pending?.keys ?? 'idle'}</button>
      </FocusScope>
    )
  }
  const view = render(
    <HotkeysProvider dispatcher={first}>
      <Child />
    </HotkeysProvider>,
  )
  const button = view.getByRole('button')
  expect(button.textContent).toBe('K')
  const previous = first.nodeForElement(button)
  expect(previous).not.toBeNull()
  view.rerender(
    <HotkeysProvider dispatcher={second}>
      <Child />
    </HotkeysProvider>,
  )
  expect(button.textContent).toBe('idle')
  expect(first.nodeForElement(button)).toBeNull()
  expect(second.nodeForElement(button)).not.toBe(previous)
  view.unmount()
  expect(second.nodeForElement(button)).toBeNull()
  expect(first.pending()?.keys).toBe('K')
})

it('fails explicitly outside a focus provider', () => {
  expect(() => renderHook(() => useFocusNode({}))).toThrow('with a dispatcher or keymap')
})

it('preserves stable row handles and re-registers on a different registry document', () => {
  const iframe = document.body.appendChild(document.createElement('iframe'))
  const other = iframe.contentDocument!
  using first = createHotkeyRegistry({ document })
  using second = createHotkeyRegistry({ document: other })
  const save = vi.fn()
  const aux = vi.fn()
  const rows = [
    { id: 'save', hotkey: 'F8', callback: save },
    { id: 'aux', sequence: [{ code: 'KeyG' }, 'H'], callback: aux },
  ] as const satisfies readonly UseHotkeyDefinition[]

  function Child({ definitions }: { definitions: readonly UseHotkeyDefinition[] }) {
    useHotkeys(definitions)
    const registrations = useHotkeyRegistrations()
    return <output>{registrations.hotkeys[0]?.triggerCount ?? -1}</output>
  }
  try {
    const view = render(
      <HotkeysProvider registry={first}>
        <Child definitions={rows} />
      </HotkeysProvider>,
    )
    const [initial] = Array.from(first.registrations.state.values())
    press(document, 'F8', { code: 'F8' })
    expect(view.getByRole('status').textContent).toBe('1')
    view.rerender(
      <HotkeysProvider registry={first}>
        <Child definitions={rows.toReversed()} />
      </HotkeysProvider>,
    )
    expect(first.registrations.state.get(initial!.id)?.triggerCount).toBe(1)
    const rebound = [{ ...rows[0], hotkey: 'F9' }, rows[1]] as const
    view.rerender(
      <HotkeysProvider registry={first}>
        <Child definitions={rebound} />
      </HotkeysProvider>,
    )
    expect(first.registrations.state.has(initial!.id)).toBe(false)
    expect(view.getByRole('status').textContent).toBe('0')
    view.rerender(
      <HotkeysProvider registry={second}>
        <Child definitions={rebound} />
      </HotkeysProvider>,
    )
    expect(first.registrations.state.size).toBe(0)
    expect(second.registrations.state.size).toBe(2)
    press(document, 'F9', { code: 'F9' })
    press(other, 'F9', { code: 'F9' })
    expect(save).toHaveBeenCalledTimes(2)
    view.unmount()
    expect(second.registrations.state.size).toBe(0)
  } finally {
    iframe.remove()
  }
})

it('rejects duplicate IDs and accepts a parsed dynamic shortcut', () => {
  using registry = createHotkeyRegistry()
  const parsed = parseShortcut('F8')
  if (!parsed.ok) throw new Error('Fixture has invalid keys')
  const callback = vi.fn()
  const rows = [{ id: 'save', hotkey: parsed.value, callback }] as const
  const view = renderHook(() => useHotkey(parsed.value, callback), { wrapper: HotkeysProvider })
  press(document, 'F8', { code: 'F8' })
  expect(callback).toHaveBeenCalledOnce()
  view.unmount()
  expect(() =>
    renderHook(() => useHotkeys(rows.concat(rows)), {
      wrapper: ({ children }) => <HotkeysProvider registry={registry}>{children}</HotkeysProvider>,
    }),
  ).toThrow('Duplicate useHotkeys id: save')
  expect(registry.registrations.state.size).toBe(0)
})

it('observes physical codes and releases each side independently', () => {
  const view = renderHook(() => [
    useKeyHold('[KeyA]'),
    useKeyHold('[ShiftLeft]'),
    useKeyHold('[ShiftRight]'),
  ])
  act(() => {
    fireEvent.keyDown(document.body, { key: 'a', code: 'KeyA' })
    fireEvent.keyDown(document.body, { key: 'Shift', code: 'ShiftLeft' })
    fireEvent.keyDown(document.body, { key: 'Shift', code: 'ShiftRight' })
  })
  expect(view.result.current).toEqual([true, true, true])
  fireEvent.keyUp(document.body, { key: 'Shift', code: 'ShiftLeft' })
  expect(view.result.current.slice(1)).toEqual([false, true])
  fireEvent.keyUp(document.body, { key: 'Shift', code: 'ShiftRight' })
  expect(view.result.current.slice(1)).toEqual([false, false])
})

it('keeps provider ownership and child command payloads constrained', () => {
  const useCheckTypes = (dispatcher: BrowserDispatcher<Commands>) => {
    App.useFocusNode({
      commands: {
        editor: ({ args }) => {
          expectTypeOf(args).toEqualTypeOf<{ index: number }>()
        },
      },
    })
    // @ts-expect-error Focus registration uses the provider's closed command names.
    App.useFocusNode({ commands: { unknown: () => {} } })
    App.useFocusNode({
      // @ts-expect-error The command handler cannot assume a different argument shape.
      commands: { editor: ({ args }: { args: { index: string } }) => Boolean(args) },
    })
    // @ts-expect-error Dispatcher and keymap ownership are exclusive.
    void (<App.HotkeysProvider dispatcher={dispatcher} keymap={bindings} />)
    // @ts-expect-error A row must specify exactly one of hotkey or sequence.
    useHotkeys([{ hotkey: 'F8', sequence: ['F9'], callback: () => {} }])
    // @ts-expect-error A row cannot omit both keys.
    useHotkeys([{ callback: () => {} }])
  }
  expectTypeOf(useCheckTypes).toBeFunction()
})
