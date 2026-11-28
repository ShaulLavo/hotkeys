import { StrictMode, createRef, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react'
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
        data-context={first.node?.context().identifiers.has('Editor') ?? false}
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
  expect(editor.getAttribute('data-context')).toBe('true')
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

it('observes a ref target a child replaces without rendering the hook owner', async () => {
  using dispatcher = createBrowserDispatcher({ keymap: [{ keys: 'F8', command: 'go' }] })
  const command = vi.fn()
  function Switchable({ target }: { target: React.RefObject<HTMLButtonElement | null> }) {
    const [version, setVersion] = useState(0)
    return (
      <button key={version} ref={target} onClick={() => setVersion((n) => n + 1)}>
        Target {version}
      </button>
    )
  }
  function Owner() {
    const target = useRef<HTMLButtonElement>(null)
    useFocusNode({ target, commands: { go: command } })
    return <Switchable target={target} />
  }
  const view = render(
    <HotkeysProvider dispatcher={dispatcher}>
      <Owner />
    </HotkeysProvider>,
  )
  const before = view.getByRole('button')
  expect(dispatcher.nodeForElement(before)).not.toBeNull()
  fireEvent.click(before)
  const after = view.getByRole('button', { name: 'Target 1' })
  expect(after).not.toBe(before)
  await waitFor(() => expect(dispatcher.nodeForElement(after)).not.toBeNull())
  expect(dispatcher.nodeForElement(before)).toBeNull()
  press(after, 'F8', { code: 'F8' })
  expect(command).toHaveBeenCalledOnce()
})

it('detaches a composed ref when the wrapper returns no cleanup', async () => {
  using dispatcher = createBrowserDispatcher()
  function Owner({ visible }: { visible: boolean }) {
    const { ref } = useFocusNode({ context: 'Editor' })
    return visible ? (
      <button
        ref={(element) => {
          ref(element)
        }}
      >
        Target
      </button>
    ) : null
  }
  const view = render(
    <HotkeysProvider dispatcher={dispatcher}>
      <Owner visible />
    </HotkeysProvider>,
  )
  const element = view.getByRole('button')
  expect(dispatcher.nodeForElement(element)).not.toBeNull()
  view.rerender(
    <HotkeysProvider dispatcher={dispatcher}>
      <Owner visible={false} />
    </HotkeysProvider>,
  )
  await waitFor(() => expect(dispatcher.nodeForElement(element)).toBeNull())
})

it('rolls back a focus node when forwarding the scope ref throws', () => {
  using dispatcher = createBrowserDispatcher()
  const target: { current: HTMLDivElement | null } = { current: null }
  expect(() =>
    render(
      <HotkeysProvider dispatcher={dispatcher}>
        <FocusScope
          ref={(element) => {
            if (!element) return
            target.current = element
            throw new Error('ref failed')
          }}
        >
          Scope
        </FocusScope>
      </HotkeysProvider>,
    ),
  ).toThrow('ref failed')
  expect(target.current).not.toBeNull()
  expect(dispatcher.nodeForElement(target.current!)).toBeNull()
})

it('reacquires a later row after an earlier replace invalidates its handle', () => {
  using registry = createHotkeyRegistry()
  const later = vi.fn()
  function Rows({ rebound }: { rebound: boolean }) {
    useHotkeys([
      {
        id: 'first',
        hotkey: rebound ? 'F9' : 'F8',
        callback: () => false,
        options: { conflictBehavior: 'replace' },
      },
      { id: 'later', hotkey: 'F9', callback: later, options: { conflictBehavior: 'allow' } },
    ])
    return null
  }
  const view = render(
    <HotkeysProvider registry={registry}>
      <Rows rebound={false} />
    </HotkeysProvider>,
  )
  expect(registry.registrations.state.size).toBe(2)
  view.rerender(
    <HotkeysProvider registry={registry}>
      <Rows rebound />
    </HotkeysProvider>,
  )
  expect(registry.registrations.state.size).toBe(2)
  press(document, 'F9', { code: 'F9' })
  expect(later).toHaveBeenCalledOnce()
})

it('routes a ref moved between existing elements before the next key', () => {
  using dispatcher = createBrowserDispatcher({ keymap: [{ keys: 'F8', command: 'go' }] })
  const command = vi.fn()
  function Targets({ target }: { target: React.RefObject<HTMLButtonElement | null> }) {
    const [second, setSecond] = useState(false)
    return (
      <>
        <button ref={second ? null : target} onClick={() => setSecond(true)}>
          First
        </button>
        <button ref={second ? target : null}>Second</button>
      </>
    )
  }
  function Owner() {
    const target = useRef<HTMLButtonElement>(null)
    useFocusNode({ target, commands: { go: command } })
    return <Targets target={target} />
  }
  const view = render(
    <HotkeysProvider dispatcher={dispatcher}>
      <Owner />
    </HotkeysProvider>,
  )
  const first = view.getByRole('button', { name: 'First' })
  const second = view.getByRole('button', { name: 'Second' })
  fireEvent.click(first)
  press(first, 'F8', { code: 'F8' })
  expect(command).not.toHaveBeenCalled()
  press(second, 'F8', { code: 'F8' })
  expect(command).toHaveBeenCalledOnce()
  expect(dispatcher.nodeForElement(first)).toBeNull()
})

it('observes a shadow target after finding it during dispatch', async () => {
  using dispatcher = createBrowserDispatcher({ keymap: [{ keys: 'F8', command: 'go' }] })
  const command = vi.fn()
  const host = document.body.appendChild(document.createElement('div'))
  const shadow = host.attachShadow({ mode: 'open' })
  function Targets({ target }: { target: React.RefObject<HTMLButtonElement | null> }) {
    const [shown, setShown] = useState(false)
    return (
      <>
        <button onClick={() => setShown((value) => !value)}>Show</button>
        {shown && createPortal(<button ref={target}>Target</button>, shadow)}
      </>
    )
  }
  function Owner() {
    const target = useRef<HTMLButtonElement>(null)
    useFocusNode({ target, commands: { go: command } })
    return <Targets target={target} />
  }
  try {
    const view = render(
      <HotkeysProvider dispatcher={dispatcher}>
        <Owner />
      </HotkeysProvider>,
    )
    fireEvent.click(view.getByRole('button', { name: 'Show' }))
    const button = shadow.querySelector('button')!
    press(button, 'F8', { code: 'F8', composed: true })
    expect(command).toHaveBeenCalledOnce()
    fireEvent.click(view.getByRole('button', { name: 'Show' }))
    await waitFor(() => expect(dispatcher.nodeForElement(button)).toBeNull())
    view.unmount()
  } finally {
    host.remove()
  }
})

it('updates nested attachments before the first key after their parent ref moves', () => {
  using dispatcher = createBrowserDispatcher({
    keymap: [{ keys: 'F8', command: 'go', context: 'Outer > Inner' }],
  })
  const command = vi.fn()
  function Surfaces({
    target,
    children,
  }: {
    target: React.RefObject<HTMLDivElement | null>
    children: React.ReactNode
  }) {
    const [second, setSecond] = useState(false)
    return (
      <>
        <button onClick={() => setSecond(true)}>Move scope</button>
        <div ref={second ? null : target}>First surface</div>
        <div ref={second ? target : null}>Second surface</div>
        {children}
      </>
    )
  }
  function Owner() {
    const target = useRef<HTMLDivElement>(null)
    return (
      <FocusScope context='Outer' target={target}>
        <Surfaces target={target}>
          <FocusScope context='Inner' commands={{ go: command }}>
            <button>Nested</button>
          </FocusScope>
        </Surfaces>
      </FocusScope>
    )
  }
  const view = render(
    <HotkeysProvider dispatcher={dispatcher}>
      <Owner />
    </HotkeysProvider>,
  )
  const nested = view.getByRole('button', { name: 'Nested' })
  press(nested, 'F8', { code: 'F8' })
  expect(command).toHaveBeenCalledOnce()
  const previous = dispatcher.nodeForElement(nested)
  fireEvent.click(view.getByRole('button', { name: 'Move scope' }))
  press(nested, 'F8', { code: 'F8' })
  expect(command).toHaveBeenCalledTimes(2)
  expect(dispatcher.nodeForElement(nested)?.parent).not.toBe(previous?.parent)
})

it('compares object refs with the current attachment after owner and child commits', () => {
  using dispatcher = createBrowserDispatcher({ keymap: [{ keys: 'F8', command: 'go' }] })
  const matched: EventTarget[] = []

  function Targets({
    moved,
    target,
  }: {
    moved: boolean
    target: React.RefObject<HTMLButtonElement | null>
  }) {
    const [back, setBack] = useState(false)
    const second = moved && !back
    return (
      <>
        <button ref={second ? null : target}>First</button>
        <button ref={second ? target : null}>Second</button>
        <button onClick={() => setBack(true)}>Move back</button>
      </>
    )
  }
  function Owner({ moved }: { moved: boolean }) {
    const target = useRef<HTMLButtonElement>(null)
    useFocusNode({
      target,
      commands: {
        go: ({ source }) => {
          if (source?.target) matched.push(source.target)
        },
      },
    })
    return <Targets moved={moved} target={target} />
  }
  const app = (moved: boolean) => (
    <HotkeysProvider dispatcher={dispatcher}>
      <Owner moved={moved} />
    </HotkeysProvider>
  )
  const view = render(app(false))
  const first = view.getByRole('button', { name: 'First' })
  const second = view.getByRole('button', { name: 'Second' })
  view.rerender(app(true))
  expect(dispatcher.nodeForElement(second)).not.toBeNull()
  fireEvent.click(view.getByRole('button', { name: 'Move back' }))
  press(first, 'F8', { code: 'F8' })
  press(second, 'F8', { code: 'F8' })
  expect(matched).toEqual([first])
})

it('tracks target removal after its detached container moves into a shadow root', async () => {
  using dispatcher = createBrowserDispatcher({ keymap: [{ keys: 'F8', command: 'go' }] })
  const portal = document.body.appendChild(document.createElement('div'))
  const host = document.body.appendChild(document.createElement('div'))
  const shadow = host.attachShadow({ mode: 'open' })

  function Targets({ target }: { target: React.RefObject<HTMLButtonElement | null> }) {
    const [shown, setShown] = useState(true)
    return (
      <>
        <button onClick={() => setShown(false)}>Remove target</button>
        {createPortal(shown ? <button ref={target}>Portal target</button> : null, portal)}
      </>
    )
  }
  function Owner() {
    const target = useRef<HTMLButtonElement>(null)
    useFocusNode({ target, commands: { go: () => {} } })
    return <Targets target={target} />
  }

  const view = render(
    <HotkeysProvider dispatcher={dispatcher}>
      <Owner />
    </HotkeysProvider>,
  )
  try {
    const button = portal.querySelector('button')!
    expect(dispatcher.nodeForElement(button)).not.toBeNull()
    await act(async () => {
      await new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          observer.disconnect()
          resolve()
        })
        observer.observe(document.body, { childList: true })
        portal.remove()
      })
    })
    shadow.append(portal)
    fireEvent.click(view.getByRole('button', { name: 'Remove target' }))
    await waitFor(() => expect(dispatcher.nodeForElement(button)).toBeNull())
  } finally {
    view.unmount()
    portal.remove()
    host.remove()
  }
})

it('keeps watching the document while a ref points into a detached portal', async () => {
  using dispatcher = createBrowserDispatcher({ keymap: [{ keys: 'F8', command: 'go' }] })
  const portal = document.body.appendChild(document.createElement('div'))
  const command = vi.fn()

  function Targets({ target }: { target: React.RefObject<HTMLButtonElement | null> }) {
    const [moved, setMoved] = useState(false)
    return (
      <>
        <button onClick={() => setMoved(true)}>Move to document</button>
        {createPortal(<button ref={moved ? null : target}>Portal target</button>, portal)}
        {moved && <button ref={target}>Document target</button>}
      </>
    )
  }
  function Owner() {
    const target = useRef<HTMLButtonElement>(null)
    useFocusNode({ target, commands: { go: command } })
    return <Targets target={target} />
  }

  const view = render(
    <HotkeysProvider dispatcher={dispatcher}>
      <Owner />
    </HotkeysProvider>,
  )
  try {
    const before = portal.querySelector('button')!
    expect(dispatcher.nodeForElement(before)).not.toBeNull()
    await act(async () => {
      await new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          observer.disconnect()
          resolve()
        })
        observer.observe(document.body, { childList: true })
        portal.remove()
      })
    })
    fireEvent.click(view.getByRole('button', { name: 'Move to document' }))
    const after = view.getByRole('button', { name: 'Document target' })
    await waitFor(() => expect(dispatcher.nodeForElement(after)).not.toBeNull())
    expect(dispatcher.nodeForElement(before)).toBeNull()
    expect(portal.contains(before)).toBe(true)
    press(after, 'F8', { code: 'F8' })
    expect(command).toHaveBeenCalledOnce()
  } finally {
    view.unmount()
    portal.remove()
  }
})

it('registers a replacement in a detached portal before any key event', async () => {
  using dispatcher = createBrowserDispatcher({ keymap: [{ keys: 'F8', command: 'go' }] })
  const portal = document.body.appendChild(document.createElement('div'))
  const host = document.body.appendChild(document.createElement('div'))
  const shadow = host.attachShadow({ mode: 'open' })
  const command = vi.fn()

  function Targets({ target }: { target: React.RefObject<HTMLButtonElement | null> }) {
    const [shown, setShown] = useState(true)
    return (
      <>
        <button onClick={() => setShown(!shown)}>Toggle target</button>
        {createPortal(shown ? <button ref={target}>Target</button> : null, portal)}
      </>
    )
  }
  function Owner() {
    const target = useRef<HTMLButtonElement>(null)
    useFocusNode({ target, commands: { go: command } })
    return <Targets target={target} />
  }

  const view = render(
    <HotkeysProvider dispatcher={dispatcher}>
      <Owner />
    </HotkeysProvider>,
  )
  try {
    const before = portal.querySelector('button')!
    expect(dispatcher.nodeForElement(before)).not.toBeNull()
    await act(async () => {
      await new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          observer.disconnect()
          resolve()
        })
        observer.observe(document.body, { childList: true })
        portal.remove()
      })
    })
    const toggle = view.getByRole('button', { name: 'Toggle target' })
    fireEvent.click(toggle)
    await waitFor(() => expect(dispatcher.nodeForElement(before)).toBeNull())
    fireEvent.click(toggle)
    const after = portal.querySelector('button')!
    expect(after).not.toBe(before)
    await waitFor(() => expect(dispatcher.nodeForElement(after)).not.toBeNull())
    shadow.append(portal)
    press(after, 'F8', { code: 'F8', composed: true })
    expect(command).toHaveBeenCalledOnce()
    view.unmount()
    expect(dispatcher.nodeForElement(after)).toBeNull()
  } finally {
    view.unmount()
    portal.remove()
    host.remove()
  }
})

it.each(['callback', 'object'] as const)(
  'resolves a same-turn detached portal remount with a %s ref',
  async (mode) => {
    using dispatcher = createBrowserDispatcher({
      keymap: [{ keys: 'F8', command: 'go', context: 'Portal' }],
    })
    const portal = document.body.appendChild(document.createElement('div'))
    const host = document.body.appendChild(document.createElement('div'))
    const shadow = host.attachShadow({ mode: 'open' })
    const command = vi.fn()
    const synchronous: boolean[] = []

    function Targets({ bindTarget }: { bindTarget: React.Ref<HTMLButtonElement> }) {
      const [stage, setStage] = useState('mounted')
      function detach() {
        portal.remove()
        setStage('detached')
      }
      return (
        <>
          <button onClick={detach}>Detach and clear</button>
          <button onClick={() => setStage('remounted')}>Remount</button>
          {createPortal(
            stage === 'detached' ? null : (
              <button ref={bindTarget} data-stage={stage}>
                Target
              </button>
            ),
            portal,
          )}
        </>
      )
    }

    function Owner() {
      const target = useRef<HTMLButtonElement>(null)
      const { ref } = useFocusNode({
        context: 'Portal',
        commands: { go: command },
        ...(mode === 'object' && { target }),
      })
      const recordAttachment: React.RefCallback<HTMLButtonElement> = (element) => {
        const detach = ref(element)
        if (element?.dataset.stage === 'remounted') {
          const node = dispatcher.nodeForElement(element)
          synchronous.push(
            node !== null &&
              node.context().identifiers.has('Portal') &&
              dispatcher.dispatchCommandFrom(node, 'go'),
          )
        }
        return detach
      }
      return <Targets bindTarget={mode === 'callback' ? recordAttachment : target} />
    }

    const view = render(
      <HotkeysProvider dispatcher={dispatcher}>
        <Owner />
      </HotkeysProvider>,
    )
    try {
      const before = portal.querySelector('button')!
      expect(dispatcher.nodeForElement(before)).not.toBeNull()
      fireEvent.click(view.getByRole('button', { name: 'Detach and clear' }))
      await waitFor(() => expect(dispatcher.nodeForElement(before)).toBeNull())

      fireEvent.click(view.getByRole('button', { name: 'Remount' }))
      const after = portal.querySelector('button')!
      expect(after).not.toBe(before)
      if (mode === 'callback') {
        expect(synchronous.length).toBeGreaterThan(0)
        expect(synchronous).not.toContain(false)
        expect(dispatcher.nodeForElement(after)).not.toBeNull()
      }
      command.mockClear()
      shadow.append(portal)
      press(after, 'F8', { code: 'F8', composed: true })
      expect(command).toHaveBeenCalledOnce()
      expect(dispatcher.nodeForElement(after)).not.toBeNull()
      view.unmount()
      expect(dispatcher.nodeForElement(after)).toBeNull()
    } finally {
      view.unmount()
      portal.remove()
      host.remove()
    }
  },
)
