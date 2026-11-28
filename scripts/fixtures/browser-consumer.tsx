import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  createBrowserDispatcher,
  createHotkeyRegistry,
  getKeyStateTracker,
} from '@shaulavo/hotkeys'
import type { KeymapEntry } from '@shaulavo/hotkeys'
import { createHotkeysContext, useHotkeys, useKeyHold } from '@shaulavo/hotkeys/react'

type Commands = { workspace: void; editor: void; chord: void }
const App = createHotkeysContext<Commands>()
const keymap: readonly KeymapEntry<Commands>[] = [
  { keys: 'Mod+B', command: 'workspace', context: 'Workspace' },
  { keys: 'Mod+B', command: 'editor', context: 'Editor' },
  { keys: 'Mod+K Mod+C', command: 'chord', context: 'Workspace' },
]

const frames = ['first', 'second'].map((id) => {
  const frame = document.body.appendChild(document.createElement('iframe'))
  frame.id = id
  const doc = frame.contentDocument!
  const button = doc.body.appendChild(doc.createElement('button'))
  button.textContent = id
  return { frame, registry: createHotkeyRegistry({ document: doc }) }
})
const external = createBrowserDispatcher<Commands>({ keymap, platform: 'linux', capture: true })
const sentinel = external.createNode({ commands: { workspace: () => {} } })
const output = document.querySelector('pre')!
function log(message: string) {
  output.textContent += message + '\n'
}
const rows = [
  { id: 'save', hotkey: 'F8', callback: () => log('registered'), options: { target: null } },
] as const

function Editor() {
  const { ref } = App.useFocusNode({ context: 'Editor', commands: { editor: () => log('editor') } })
  return <textarea aria-label='Editor' ref={ref} />
}

function Status() {
  const pending = App.usePendingChord()
  const left = useKeyHold('[ShiftLeft]')
  const right = useKeyHold('[ShiftRight]')
  return (
    <>
      <output aria-label='Pending'>{pending?.keys ?? 'idle'}</output>
      <output aria-label='Shift'>
        {Number(left)}
        {Number(right)}
      </output>
    </>
  )
}

function Workspace() {
  useHotkeys(rows)
  return (
    <App.FocusScope
      context='Workspace'
      commands={{
        workspace: () => log('workspace'),
        chord: () => log('chord'),
      }}
    >
      <button>Workspace</button>
      <Editor />
      <Status />
    </App.FocusScope>
  )
}

function Fixture() {
  const [swapped, setSwapped] = useState(false)
  const registry = frames[swapped ? 1 : 0]!.registry
  const ownership = swapped
    ? { dispatcher: external }
    : { keymap, platform: 'linux' as const, capture: true }
  return (
    <>
      <button onClick={() => setSwapped(true)}>Swap</button>
      <App.HotkeysProvider registry={registry} {...ownership}>
        <Workspace />
      </App.HotkeysProvider>
    </>
  )
}

const ReactRoot = createRoot(document.querySelector('main')!)
const listeners = trackKeyListeners()
const baseline = listeners()
ReactRoot.render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
)
document.querySelector('body > button')!.addEventListener('click', () => {
  const editor = document.querySelector('textarea')!
  ReactRoot.unmount()
  getKeyStateTracker().dispose()
  const after = listeners()
  const ownedReleased = JSON.stringify(after) === JSON.stringify(baseline)
  if (!ownedReleased) console.error('Listener snapshot:', JSON.stringify({ baseline, after }))
  const nodesReleased = external.nodeForElement(editor) === null
  const rowsReleased = frames.every(({ registry }) => registry.registrations.state.size === 0)
  const externalRetained = external.dispatchCommandFrom(sentinel, 'workspace')
  external.dispose()
  for (const { frame, registry } of frames) {
    const handle = registry.register('F9', () => {})
    handle.dispose()
    registry.dispose()
    frame.remove()
  }
  log([ownedReleased, nodesReleased, rowsReleased, externalRetained].join(','))
})

function trackKeyListeners() {
  const nativeAdd = EventTarget.prototype.addEventListener
  const nativeRemove = EventTarget.prototype.removeEventListener
  type Handler = EventListenerOrEventListenerObject | null
  const active = new Map<EventTarget, Map<string, Set<Handler>>>()
  const windowEvents = new Set(['keydown', 'keyup', 'blur'])
  const documentEvents = new Set([
    'keydown',
    'keyup',
    'focusout',
    'visibilitychange',
    'pointerdown',
  ])

  function eventsForDocument(target: EventTarget) {
    return target === document ? documentEvents : null
  }

  function handlers(target: EventTarget, type: string, options?: boolean | EventListenerOptions) {
    const tracked = target === window ? windowEvents : eventsForDocument(target)
    if (!tracked?.has(type)) return undefined
    let events = active.get(target)
    if (!events) active.set(target, (events = new Map()))
    const key = `${type}:${typeof options === 'boolean' ? options : Boolean(options?.capture)}`
    let callbacks = events.get(key)
    if (!callbacks) events.set(key, (callbacks = new Set()))
    return callbacks
  }
  EventTarget.prototype.addEventListener = function (type, callback, options) {
    nativeAdd.call(this, type, callback, options)
    handlers(this, type, options)?.add(callback)
  }
  EventTarget.prototype.removeEventListener = function (type, callback, options) {
    nativeRemove.call(this, type, callback, options)
    handlers(this, type, options)?.delete(callback)
  }
  return () =>
    Array.from(active, ([target, events]) =>
      Array.from(events, ([event, callbacks]) =>
        Array.from(callbacks, (callback) => [
          target === window ? 'window' : 'document',
          event,
          typeof callback === 'function' ? callback.name : String(callback),
        ]),
      ).flat(),
    ).flat()
}
