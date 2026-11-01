import { afterEach, expect, test, vi } from 'vitest'
import { createHotkeyRegistry } from '../src/index.js'
import type { HotkeyRegistrationHandle, HotkeyRegistry } from '../src/index.js'

let registry: HotkeyRegistry | undefined
const subscriptions: Array<{ unsubscribe: () => void }> = []

afterEach(() => {
  for (const subscription of subscriptions.splice(0)) subscription.unsubscribe()
  registry?.dispose()
  registry = undefined
  vi.restoreAllMocks()
})

function setup() {
  registry = createHotkeyRegistry()
  return registry
}

function subscribe(callback: () => void) {
  const subscription = registry!.registrations.subscribe(callback)
  subscriptions.push(subscription)
  return subscription
}

function press(key: string) {
  const event = new KeyboardEvent('keydown', {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
  })
  document.dispatchEvent(event)
  return event
}

function thrownBy(action: () => void): unknown {
  try {
    action()
  } catch (error) {
    return error
  }
  return undefined
}

test('a publishing failure releases the new registration and its command handler', () => {
  const hotkeys = setup()
  const failure = new Error('registration observer failed')
  const callback = vi.fn()
  const root = hotkeys.dispatcher.focused()!
  const addHandler = root.handle
  const released = vi.fn()
  vi.spyOn(root, 'handle').mockImplementation((command, handler) => {
    const release = addHandler(command, handler)
    return () => {
      released()
      release()
    }
  })
  let failedId: string | undefined
  const observer = subscribe(() => {
    if (hotkeys.registrations.state.size === 0) return
    failedId = hotkeys.registrations.state.keys().next().value
    throw failure
  })

  expect(thrownBy(() => hotkeys.register('F8', callback))).toBe(failure)
  observer.unsubscribe()
  expect(released).toHaveBeenCalledOnce()
  expect(hotkeys.registrations.state.size).toBe(0)
  expect(hotkeys.trigger(failedId!)).toBe(false)
  expect(press('F8').defaultPrevented).toBe(false)
  expect(callback).not.toHaveBeenCalled()
})

test('acquisition cleanup preserves existing unrelated registrations and counters', () => {
  const hotkeys = setup()
  const existingCallback = vi.fn()
  const existing = hotkeys.register('F7', existingCallback, { meta: { name: 'keep' } })
  hotkeys.trigger(existing.id)
  const failure = new Error('observer failed')
  const failedCallback = vi.fn()
  const observer = subscribe(() => {
    if (hotkeys.registrations.state.size > 1) throw failure
  })

  expect(thrownBy(() => hotkeys.register('F8', failedCallback))).toBe(failure)
  observer.unsubscribe()
  expect(Array.from(hotkeys.registrations.state.keys())).toEqual([existing.id])
  expect(hotkeys.registrations.state.get(existing.id)).toMatchObject({
    triggerCount: 1,
    options: { meta: { name: 'keep' } },
  })
  expect(existing.isActive).toBe(true)
  press('F8')
  press('F7')
  expect(failedCallback).not.toHaveBeenCalled()
  expect(existingCallback).toHaveBeenCalledTimes(2)
})

test('a failed replacement does not resurrect the registration it already removed', () => {
  const hotkeys = setup()
  const previousCallback = vi.fn()
  const previous = hotkeys.register('F8', previousCallback)
  const failedCallback = vi.fn()
  const failure = new Error('replacement observer failed')
  const observer = subscribe(() => {
    if (hotkeys.registrations.state.size) throw failure
  })

  expect(
    thrownBy(() => hotkeys.register('F8', failedCallback, { conflictBehavior: 'replace' })),
  ).toBe(failure)
  observer.unsubscribe()
  expect(previous.isActive).toBe(false)
  expect(hotkeys.registrations.state.size).toBe(0)
  expect(press('F8').defaultPrevented).toBe(false)
  expect(previousCallback).not.toHaveBeenCalled()
  expect(failedCallback).not.toHaveBeenCalled()
})

test('cleanup preserves a nested independent registration created by the observer', () => {
  const hotkeys = setup()
  const failure = new Error('outer observer failed')
  const failedCallback = vi.fn()
  const nestedCallback = vi.fn()
  let nested: HotkeyRegistrationHandle | undefined
  let entered = false
  const observer = subscribe(() => {
    if (entered) return
    entered = true
    nested = hotkeys.register('F9', nestedCallback)
    throw failure
  })

  expect(thrownBy(() => hotkeys.register('F8', failedCallback))).toBe(failure)
  observer.unsubscribe()
  expect(nested?.isActive).toBe(true)
  expect(Array.from(hotkeys.registrations.state.keys())).toEqual([nested!.id])
  press('F8')
  press('F9')
  expect(failedCallback).not.toHaveBeenCalled()
  expect(nestedCallback).toHaveBeenCalledOnce()
})

test('cleanup cannot remove a nested registration that replaced the failed acquisition', () => {
  const hotkeys = setup()
  const failure = new Error('outer observer failed')
  const failedCallback = vi.fn()
  const nestedCallback = vi.fn()
  let nested: HotkeyRegistrationHandle | undefined
  let entered = false
  const observer = subscribe(() => {
    if (entered) return
    entered = true
    nested = hotkeys.register('F8', nestedCallback, { conflictBehavior: 'replace' })
    throw failure
  })

  expect(thrownBy(() => hotkeys.register('F8', failedCallback))).toBe(failure)
  observer.unsubscribe()
  expect(nested?.isActive).toBe(true)
  expect(Array.from(hotkeys.registrations.state.keys())).toEqual([nested!.id])
  press('F8')
  expect(failedCallback).not.toHaveBeenCalled()
  expect(nestedCallback).toHaveBeenCalledOnce()
})

test('a cleanup notification failure does not mask the original acquisition error', () => {
  const hotkeys = setup()
  const original = new Error('original observer error')
  const cleanup = new Error('cleanup observer error')
  const callback = vi.fn()
  let notified = false
  const observer = subscribe(() => {
    const failure = notified ? cleanup : original
    notified = true
    throw failure
  })

  expect(thrownBy(() => hotkeys.register('F8', callback))).toBe(original)
  observer.unsubscribe()
  expect(hotkeys.registrations.state.size).toBe(0)
  expect(press('F8').defaultPrevented).toBe(false)
  expect(callback).not.toHaveBeenCalled()
})

test('disposal during publication is not undone by acquisition cleanup', () => {
  const hotkeys = setup()
  const failure = new Error('observer disposed the registry')
  const callback = vi.fn()
  let entered = false
  const observer = subscribe(() => {
    if (entered) return
    entered = true
    hotkeys.dispose()
    throw failure
  })

  expect(thrownBy(() => hotkeys.register('F8', callback))).toBe(failure)
  observer.unsubscribe()
  expect(hotkeys.registrations.state.size).toBe(0)
  expect(press('F8').defaultPrevented).toBe(false)
  expect(callback).not.toHaveBeenCalled()
})
