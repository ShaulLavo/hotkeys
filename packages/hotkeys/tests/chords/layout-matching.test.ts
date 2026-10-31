import { expect, test } from 'vitest'
import {
  buildKeymapTrie,
  createKeyInput,
  matchesKeyInput,
  parseRegisterableHotkey,
  trieStep,
} from '../../src/index.js'
import type { KeyInput, KeymapBinding, RegisterableHotkey } from '../../src/index.js'

function expectMatch(input: KeyInput, hotkey: RegisterableHotkey, expected: boolean) {
  const parsed = parseRegisterableHotkey(hotkey, 'linux')
  const trie = buildKeymapTrie([{ chord: [hotkey], payload: 'matched' }], 'linux')
  expect(matchesKeyInput(input, parsed, 'linux'), 'matching helper').toBe(expected)
  expect(trieStep(trie, input)?.node.candidates[0]?.payload === 'matched', 'trie').toBe(expected)
}

function expectPreferred(
  input: KeyInput,
  preferred: RegisterableHotkey,
  other: RegisterableHotkey,
) {
  const bindings: KeymapBinding<string>[] = [
    { chord: [preferred], payload: 'preferred' },
    { chord: [other], payload: 'other' },
  ]
  for (const order of [bindings, bindings.toReversed()]) {
    const trie = buildKeymapTrie(order, 'linux')
    expect(trieStep(trie, input)?.node.candidates.map((binding) => binding.payload)).toEqual([
      'preferred',
    ])
  }
}

test.each([
  ['?', 'Slash'],
  ['?', 'Comma'],
  ['?', ''],
  ['+', 'Equal'],
  ['%', 'Digit5'],
  ['1', 'Digit1'],
  ['١', 'Digit1'],
  ['💡', ''],
])('a logical %s matches its shifted glyph from %s in both matchers', (key, code) => {
  expectMatch(createKeyInput({ key, code, modifiers: { shift: true } }), { key }, true)
  expectMatch(createKeyInput({ key, code }), { key }, true)
})

test('literal plus syntax retains the other requested modifiers', () => {
  const input = createKeyInput({ key: '+', code: 'Equal', modifiers: { ctrl: true, shift: true } })
  expectMatch(input, 'Control++', true)
  expectMatch(input, '+', false)
  expectMatch(input, 'Alt++', false)
})

test('implicit Shift preserves all combinations of Control, Alt, and Meta', () => {
  for (let mask = 0; mask < 8; mask += 1) {
    const modifiers = { alt: !!(mask & 1), ctrl: !!(mask & 2), meta: !!(mask & 4) }
    const input = createKeyInput({
      key: '?',
      code: 'Slash',
      modifiers: Object.assign({ shift: true }, modifiers),
    })
    const hotkey = Object.assign({ key: '?' }, modifiers)
    expectMatch(input, hotkey, true)
    for (const modifier of ['alt', 'ctrl', 'meta'] as const) {
      expectMatch(input, Object.assign({}, hotkey, { [modifier]: !modifiers[modifier] }), false)
    }
  }
})

test.each(['A', 'é', 'ß', 'Ж', 'Ω', '𐐀'])(
  'Shift stays explicit for the Unicode letter %s',
  (key) => {
    const input = createKeyInput({ key, code: 'KeyQ', modifiers: { shift: true } })
    expectMatch(input, { key }, false)
    expectMatch(input, { key, shift: true }, true)
  },
)

test.each(['Space', 'Enter', 'ArrowUp', 'F1', 'Dead'])(
  'Shift stays explicit for the named key %s',
  (key) => {
    const input = createKeyInput({ key, modifiers: { shift: true } })
    expectMatch(input, { key }, false)
    expectMatch(input, { key, shift: true }, true)
  },
)

test('an explicit shifted glyph wins over its implicit form', () => {
  const input = createKeyInput({ key: '?', code: 'Slash', modifiers: { shift: true } })
  expectPreferred(input, 'Shift+?', '?')
  expectMatch(createKeyInput({ key: '?', code: 'Slash' }), 'Shift+?', false)
})

test('an exact physical binding wins over an implicit logical glyph', () => {
  const input = createKeyInput({ key: '?', code: 'Slash', modifiers: { shift: true } })
  expectPreferred(input, 'Shift+[Slash]', '?')
})

test('an exact logical binding retains precedence over an exact physical binding', () => {
  const shifted = createKeyInput({ key: '?', code: 'Slash', modifiers: { shift: true } })
  expectPreferred(shifted, 'Shift+?', 'Shift+[Slash]')
  expectPreferred(createKeyInput({ key: '?', code: 'Slash' }), '?', '[Slash]')
})

test('an implicit logical glyph wins over positional fallback', () => {
  const input = createKeyInput({ key: '?', code: 'Slash', modifiers: { shift: true } })
  expectPreferred(input, '?', 'Shift+/')
})

test('physical code bindings retain exact modifiers and code identity', () => {
  const shifted = createKeyInput({ key: '?', code: 'Slash', modifiers: { shift: true } })
  expectMatch(shifted, '[Slash]', false)
  expectMatch(shifted, 'Shift+[Slash]', true)
  expectMatch(shifted, 'Shift+[Equal]', false)
  expectMatch(createKeyInput({ key: '?', code: 'Slash' }), 'Shift+[Slash]', false)
})

test('positional fallback retains the full Shift mask', () => {
  const shifted = createKeyInput({ key: '?', code: 'Slash', modifiers: { shift: true } })
  expectMatch(shifted, '/', false)
  expectMatch(shifted, 'Shift+/', true)
  const dead = createKeyInput({ key: 'Dead', code: 'Slash', modifiers: { shift: true } })
  expectMatch(dead, '/', false)
  expectMatch(dead, 'Shift+/', true)
})

test('AltGraph-produced glyphs allow implicit Shift without accepting synthetic Control+Alt', () => {
  const input = createKeyInput({
    key: '?',
    code: 'Slash',
    modifiers: { shift: true, ctrl: true, alt: true, altGraph: true },
  })
  expectMatch(input, '?', true)
  expectMatch(input, 'Shift+?', true)
  expectMatch(input, 'Control+Alt+?', false)
  expectMatch(input, 'Control+Alt+Shift+?', false)
  expectMatch(input, 'Shift+[Slash]', true)
  expectMatch(input, '[Slash]', false)
})

test('AltGraph normalization retains Meta when matching a shifted glyph', () => {
  const input = createKeyInput({
    key: '?',
    code: 'Slash',
    modifiers: { shift: true, ctrl: true, alt: true, meta: true, altGraph: true },
  })
  expectMatch(input, 'Meta+?', true)
  expectMatch(input, '?', false)
  expectMatch(input, 'Control+Meta+?', false)
})

test.each([
  ['é', 'KeyE', 'E'],
  ['ø', 'KeyO', 'O'],
  ['ß', 'KeyS', 'S'],
])('native Latin %s does not fall back to its %s position without Alt', (key, code, fallback) => {
  const input = createKeyInput({ key, code, modifiers: { ctrl: true } })
  expectMatch(input, { key, ctrl: true }, true)
  expectMatch(input, { key: fallback, ctrl: true }, false)
  expectMatch(input, { code, ctrl: true }, true)
})

test.each([
  ['é', 'KeyE', 'E'],
  ['ø', 'KeyO', 'O'],
  ['ß', 'KeyS', 'S'],
])('Alt preserves the native Latin %s fallback from %s', (key, code, fallback) => {
  for (const shift of [false, true]) {
    const input = createKeyInput({ key, code, modifiers: { alt: true, shift } })
    expectMatch(input, { key: fallback, alt: true, shift }, true)
    expectMatch(input, { key: fallback, alt: true, shift: !shift }, false)
  }
})

test('a native Latin letter on a punctuation position retains positional fallback', () => {
  const input = createKeyInput({ key: 'ø', code: 'Semicolon', modifiers: { ctrl: true } })
  expectMatch(input, { key: 'ø', ctrl: true }, true)
  expectMatch(input, 'Control+;', true)
})

test('ASCII layout output stays authoritative even with Alt', () => {
  const input = createKeyInput({ key: 'a', code: 'KeyQ', modifiers: { alt: true } })
  expectMatch(input, 'Alt+A', true)
  expectMatch(input, 'Alt+Q', false)
  expectMatch(input, 'Alt+[KeyQ]', true)
})

test.each([
  ['ф', 'KeyA', 'A'],
  ['α', 'KeyA', 'A'],
  ['ა', 'KeyA', 'A'],
  ['ㅁ', 'KeyA', 'A'],
  ['ж', 'Semicolon', ';'],
])('non-Latin %s keeps exact-modifier positional fallback from %s', (key, code, fallback) => {
  const input = createKeyInput({ key, code, modifiers: { ctrl: true, shift: true } })
  expectMatch(input, { key: fallback, ctrl: true, shift: true }, true)
  expectMatch(input, { key: fallback, ctrl: true }, false)
})
