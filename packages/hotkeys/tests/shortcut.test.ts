import { expect, it, vi } from 'vitest'
import {
  areHotkeysEqual,
  createHotkeyRegistry,
  formatForDisplay,
  normalizeHotkey,
  parseHotkey,
  parseShortcut,
  registerHotkey,
} from '../src/index.js'

it.each([
  ['+', '+'],
  ['Mod++', 'Mod++'],
  ['Control++', 'Control++'],
  ['Ctrl+Shift++', 'Control+Shift++'],
  ['Mod+Plus', 'Mod++'],
  [' ', 'Space'],
])('accepts %j as %j', (text, normalized) => {
  const result = parseShortcut(text)
  expect(result.ok).toBe(true)
  if (result.ok) expect(normalizeHotkey(result.value)).toBe(normalized)
})

it.each(['Mod+', 'Control+Shift+', 'Mdo+S', '[KeyS', 'Control+Shift', '', 'Mod++S', '+S'])(
  'rejects invalid stroke %j',
  (text) => expect(parseShortcut(text)).toMatchObject({ ok: false, errors: [{ strokeIndex: 0 }] }),
)

it.each(['mac', 'linux', 'windows'] as const)(
  'keeps storage and matching distinct on %s',
  (platform) => {
    const primary = platform === 'mac' ? 'Meta' : 'Control'
    expect(normalizeHotkey('Control+K Mod+[KeyC]', { platform })).toBe('Control+K Mod+[KeyC]')
    expect(normalizeHotkey('Mod+K Mod+[KeyC]', { mode: 'resolved', platform })).toBe(
      `${primary}+K ${primary}+[KeyC]`,
    )
    expect(normalizeHotkey(`${primary}+K`, { mode: 'adaptive', platform })).toBe('Mod+K')
    expect(
      areHotkeysEqual(
        { code: 'KeyQ' },
        parseHotkey(new KeyboardEvent('keydown', { key: 'a', code: 'KeyQ' }), platform),
        platform,
      ),
    ).toBe(false)
  },
)

it('accepts a dynamic shortcut throughout the core API and disposes the registration', () => {
  const setting: string = 'Mod+K Mod+C'
  const result = parseShortcut(setting)
  if (!result.ok) throw new Error('Invalid setting')
  expect(result.warnings).toEqual([])
  expect(formatForDisplay(result.value, { platform: 'linux' })).toBe('Ctrl+K Ctrl+C')
  const callback = vi.fn()
  const handle = registerHotkey(result.value, callback, { platform: 'linux' })
  try {
    for (const key of ['k', 'c'])
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          code: `Key${key.toUpperCase()}`,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    expect(callback.mock.lastCall?.[1]).toMatchObject({
      shortcut: 'Mod+K Mod+C',
      strokes: [{ key: 'K' }, { key: 'C' }],
      stroke: { key: 'C' },
    })
  } finally {
    handle[Symbol.dispose]()
  }
  expect(handle.isActive).toBe(false)
})

it('continues through declined keyup registrations, newest first, and freezes views', () => {
  using registry = createHotkeyRegistry()
  const calls: string[] = []
  registry.register('F1', () => void calls.push('oldest'), {
    eventType: 'keyup',
    conflictBehavior: 'allow',
  })
  const accepted = registry.register('F1', () => void calls.push('accepted'), {
    eventType: 'keyup',
    conflictBehavior: 'allow',
  })
  registry.register(
    'F1',
    () => {
      calls.push('declined')
      return false
    },
    { eventType: 'keyup', conflictBehavior: 'allow' },
  )
  const event = new KeyboardEvent('keyup', { key: 'F1', cancelable: true })
  document.dispatchEvent(event)
  expect(calls).toEqual(['declined', 'accepted'])
  expect(event.defaultPrevented).toBe(true)
  const view = registry.registrations.state.get(accepted.id)!
  expect(Object.isFrozen(view)).toBe(true)
  expect(Object.isFrozen(view.strokes)).toBe(true)
  expect(Object.isFrozen(view.strokes[0])).toBe(true)
  expect(Object.isFrozen(view.options)).toBe(true)
})
