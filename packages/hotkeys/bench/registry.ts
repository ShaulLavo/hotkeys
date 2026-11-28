import { Window } from 'happy-dom'
import { createHotkeyRegistry } from '../src/index.js'

const browser = new Window()
Object.assign(globalThis, {
  document: browser.document,
  window: browser,
  KeyboardEvent: browser.KeyboardEvent,
  FocusEvent: browser.FocusEvent,
  HTMLElement: browser.HTMLElement,
})

function measure(count: number, subscribed: boolean) {
  using registry = createHotkeyRegistry()
  let published = 0
  const subscription = subscribed && registry.registrations.subscribe(() => published++)
  let fired = 0
  try {
    const start = performance.now()
    const handles = Array.from({ length: count }, (_, index) =>
      registry.register(
        { code: `Bench${index}` },
        () => {
          fired++
        },
        { conflictBehavior: 'allow' },
      ),
    )
    const registered = performance.now()
    const dispatch = (type: 'keydown' | 'keyup', code: string) =>
      document.dispatchEvent(new KeyboardEvent(type, { key: 'X', code, cancelable: true }))
    dispatch('keydown', 'Bench0')
    const firstKey = performance.now()
    for (const handle of handles) handle.setOptions({ meta: { name: 'New label' } })
    const metadata = performance.now()
    for (let index = 0; index < count; index++) {
      const code = `Bench${index}`
      dispatch('keydown', code)
      dispatch('keyup', code)
    }
    const dispatched = performance.now()
    for (const handle of handles) handle.dispose()
    const removed = performance.now()
    if (fired !== count + 1 || registry.registrations.state.size !== 0)
      throw new Error('The lifecycle benchmark did not exercise every registration')
    return {
      register: registered - start,
      firstKey: firstKey - registered,
      metadata: metadata - firstKey,
      keydownAndKeyup: dispatched - metadata,
      remove: removed - dispatched,
      published,
    }
  } finally {
    if (subscription) subscription.unsubscribe()
  }
}

try {
  measure(50, false)
  for (const count of [100, 500, 1000]) {
    for (const subscribed of [false, true]) {
      const rounds = Array.from({ length: 5 }, () => measure(count, subscribed))
      const median = (field: keyof ReturnType<typeof measure>) =>
        rounds
          .map((result) => result[field])
          .sort((a, b) => a - b)[2]!
          .toFixed(3)
      console.log({
        count,
        subscribed,
        unit: 'ms',
        register: median('register'),
        firstKey: median('firstKey'),
        metadata: median('metadata'),
        keydownAndKeyup: median('keydownAndKeyup'),
        remove: median('remove'),
        publications: median('published'),
      })
    }
  }
} finally {
  browser.close()
}
