import { afterEach, expect, test, vi } from 'vitest'
import { createBrowserDispatcher } from '../../src'
import type { BrowserDispatcher } from '../../src'

let dispatcher: BrowserDispatcher | undefined
afterEach(() => {
  dispatcher?.dispose()
  dispatcher = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(document, 'execCommand')
  vi.useRealTimers()
})

function key(target: Element, value: string) {
  const event = new KeyboardEvent('keydown', {
    key: value,
    code: `Key${value.toUpperCase()}`,
    bubbles: true,
    cancelable: true,
    composed: true,
  })
  target.dispatchEvent(event)
  return event
}

test.each(['timeout', 'mismatch', 'completion'] as const)(
  'restores all unclaimed text in order after a declined %s',
  (outcome) => {
    vi.useFakeTimers()
    const input = document.createElement('textarea')
    input.value = 'saved '
    document.body.append(input)
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
    // Exercise the browser adapter's input/textarea fallback without native execCommand.
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false })
    const inserted: Array<string | null> = []
    input.addEventListener('input', (event) => inserted.push((event as InputEvent).data))
    const command = vi.fn(() => false)
    dispatcher = createBrowserDispatcher({
      platform: 'linux',
      timeoutMs: 25,
      keymap:
        outcome === 'completion'
          ? [{ keys: 'G H I', command: 'decline' }]
          : [
              { keys: 'G H', command: 'decline' },
              { keys: 'G H I', command: 'long' },
            ],
    })
    dispatcher.attachElement(dispatcher.createNode({ commands: { decline: command } }), input)
    expect(key(input, 'g').defaultPrevented).toBe(true)
    expect(key(input, 'h').defaultPrevented).toBe(true)
    expect(input.value).toBe('saved ')

    if (outcome === 'timeout') vi.advanceTimersByTime(25)
    else {
      // Synthetic keydowns do not insert native text; only the earlier strokes are replayed.
      const current = key(input, outcome === 'completion' ? 'i' : 'x')
      expect(current.defaultPrevented).toBe(false)
    }

    expect(command).toHaveBeenCalledOnce()
    expect(input.value).toBe('saved gh')
    expect(input.selectionStart).toBe(8)
    expect(input.selectionEnd).toBe(8)
    expect(inserted).toEqual(['g', 'h'])
    expect(dispatcher.pending()).toBeNull()
    vi.advanceTimersByTime(100)
    expect(input.value).toBe('saved gh')
    expect(inserted).toEqual(['g', 'h'])
    expect(command).toHaveBeenCalledOnce()
  },
)
