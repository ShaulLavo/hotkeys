// Copied into each fresh package consumer so all imports resolve to installed artifacts.
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

const browserWindow = new Window()
Object.assign(globalThis, {
  window: browserWindow,
  document: browserWindow.document,
  Document: browserWindow.Document,
  Element: browserWindow.Element,
  Event: browserWindow.Event,
  HTMLElement: browserWindow.HTMLElement,
  HTMLInputElement: browserWindow.HTMLInputElement,
  HTMLSelectElement: browserWindow.HTMLSelectElement,
  HTMLTextAreaElement: browserWindow.HTMLTextAreaElement,
  InputEvent: browserWindow.InputEvent,
  Node: browserWindow.Node,
  KeyboardEvent: browserWindow.KeyboardEvent,
  ShadowRoot: browserWindow.ShadowRoot,
  IS_REACT_ACT_ENVIRONMENT: true,
})

const { act, Component, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { getHotkeyRegistry } = await import('@fregat/hotkeys')
const { useHotkeys, useHotkeySequences } = await import('@fregat/react-hotkeys')

class Boundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error) {
    this.props.onError(error)
  }
  render() {
    return this.state.failed ? createElement('p', null, 'Failed batch') : this.props.children
  }
}

function press(key, code) {
  for (const type of ['keydown', 'keyup']) {
    document.dispatchEvent(new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true }))
  }
}

const registry = getHotkeyRegistry()
let outsideCalls = 0
let failedCalls = 0
const outside = registry.register('F8', () => {
  outsideCalls += 1
})
const failedCallback = () => {
  failedCalls += 1
}

try {
  const publicationError = new Error('consumer publication failure')
  const subscription = registry.registrations.subscribe(() => {
    if (
      Array.from(registry.registrations.state.values()).some(
        (view) => view.options.meta?.name === 'failing',
      )
    ) {
      throw publicationError
    }
  })
  try {
    assert.throws(
      () => registry.register('A', failedCallback, { meta: { name: 'failing' } }),
      (error) => error === publicationError,
    )
  } finally {
    subscription.unsubscribe()
  }
  assert.deepEqual(Array.from(registry.registrations.state.keys()), [outside.id])
  press('a', 'KeyA')
  assert.equal(failedCalls, 0)

  for (const sequence of [false, true]) {
    const errors = []
    function BrokenBatch() {
      useHotkeys(
        sequence
          ? []
          : [
              { hotkey: 'A', callback: failedCallback },
              { hotkey: 'A', callback: failedCallback, options: { conflictBehavior: 'error' } },
            ],
      )
      useHotkeySequences(
        sequence
          ? [
              { sequence: ['G', 'H'], callback: failedCallback },
              {
                sequence: ['G', 'H'],
                callback: failedCallback,
                options: { conflictBehavior: 'error' },
              },
            ]
          : [],
      )
      return null
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container, { onCaughtError: () => {} })
    try {
      await act(() =>
        root.render(
          createElement(
            Boundary,
            {
              onError: (error) => errors.push(error),
            },
            createElement(BrokenBatch),
          ),
        ),
      )
      assert.equal(errors.length, 1)
      assert.match(errors[0].message, /already registered/)
      assert.equal(container.textContent, 'Failed batch')
      assert.deepEqual(Array.from(registry.registrations.state.keys()), [outside.id])
      await act(() => {
        press('a', 'KeyA')
        press('g', 'KeyG')
        press('h', 'KeyH')
        press('F8', 'F8')
      })
      assert.equal(failedCalls, 0)
      assert.equal(outsideCalls, sequence ? 2 : 1)
    } finally {
      await act(() => root.unmount())
      container.remove()
    }
  }
  console.log('Packed batch failures release owned shortcuts and preserve unrelated registrations.')
} finally {
  registry.dispose()
  browserWindow.close()
}
