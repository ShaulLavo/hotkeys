import { ALL_KEYS, MODIFIER_ALIASES, normalizeKeyName } from './constants.js'
import { isPrintableKey, splitHotkeyParts } from './_keyboard-event.js'
import type {
  HotkeyInput,
  HotkeySequence,
  RawHotkey,
  Shortcut,
  ValidatedStroke,
} from './hotkey.types.js'
import type { CanonicalModifier } from './key.types.js'

export type ShortcutError = {
  readonly strokeIndex: number
  readonly token: string
  readonly message: string
}

export type ParseShortcutResult =
  | { readonly ok: true; readonly value: Shortcut; readonly warnings: readonly ShortcutError[] }
  | {
      readonly ok: false
      readonly errors: readonly ShortcutError[]
      readonly warnings: readonly ShortcutError[]
    }

const modifierFields = {
  Mod: 'mod',
  Control: 'ctrl',
  Alt: 'alt',
  Shift: 'shift',
  Meta: 'meta',
} as const satisfies Record<CanonicalModifier | 'Mod', keyof ValidatedStroke>

const physicalToken = /^\[([A-Za-z][A-Za-z0-9]*)\]$/
const physicalCode = /^[A-Za-z][A-Za-z0-9]*$/
const modifierCode = /^(Alt|Control|Meta|Shift)(Left|Right)$/
const knownKeys: ReadonlySet<string> = ALL_KEYS

export function modifierAlias(token: string): CanonicalModifier | 'Mod' | undefined {
  const lower = token.toLowerCase()
  if (Object.hasOwn(MODIFIER_ALIASES, token)) return MODIFIER_ALIASES[token]
  return Object.hasOwn(MODIFIER_ALIASES, lower) ? MODIFIER_ALIASES[lower] : undefined
}

export function isShortcutSequence<Value>(input: Value | HotkeySequence): input is HotkeySequence {
  return Array.isArray(input)
}

export function parseShortcut(input: HotkeyInput | string): ParseShortcutResult {
  const sequence = shortcutStrokes(input)
  const errors: ShortcutError[] = []
  const warnings: ShortcutError[] = []
  const parsed = sequence.map((stroke, strokeIndex) => {
    const error = (token: string, message: string) => errors.push({ strokeIndex, token, message })
    const raw = typeof stroke === 'string' ? tokenizeStroke(stroke, error) : stroke
    return validateStroke(raw, error, (token, message) =>
      warnings.push({ strokeIndex, token, message }),
    )
  })
  if (parsed.length === 0) errors.push({ strokeIndex: 0, token: '', message: 'Shortcut is empty' })
  if (errors.length > 0) return { ok: false, errors, warnings }
  // Every item was validated above. Only this boundary constructs the branded tuple.
  return { ok: true, value: Object.freeze(parsed) as Shortcut, warnings }
}

function shortcutStrokes(input: HotkeyInput | string): readonly (string | RawHotkey)[] {
  if (typeof input === 'string' && input !== ' ') return input.trim().split(/\s+/)
  return isShortcutSequence(input) ? input : [input]
}

type Report = (token: string, message: string) => void

function tokenizeStroke(stroke: string, error: Report): RawHotkey {
  const text = stroke === ' ' ? 'Space' : stroke.trim()
  const tokens =
    text.endsWith('+') && text !== '+' && !text.endsWith('++')
      ? text.split('+')
      : splitHotkeyParts(text)
  const token = tokens.pop()?.trim() ?? ''
  const code = physicalToken.exec(token)?.[1]
  const raw: RawHotkey = code === undefined ? { key: token } : { code }
  for (const part of tokens) {
    const modifier = modifierAlias(part.trim())
    if (modifier === undefined) error(part, part ? 'Unknown modifier' : 'Empty modifier')
    if (modifier !== undefined) raw[modifierFields[modifier]] = true
  }
  return raw
}

function validateStroke(raw: RawHotkey, error: Report, warn: Report): ValidatedStroke {
  const modifiers = {
    mod: raw.mod ?? false,
    ctrl: raw.ctrl ?? false,
    alt: raw.alt ?? false,
    shift: raw.shift ?? false,
    meta: raw.meta ?? false,
  }
  if (raw.code !== undefined) {
    if (!physicalCode.test(raw.code) || raw.key !== undefined)
      error(raw.code, 'Invalid physical key')
    if (modifierCode.test(raw.code)) error(raw.code, 'A shortcut needs a non-modifier key')
    return Object.freeze({ ...modifiers, code: raw.code })
  }
  const key = normalizeKeyName(raw.key === ' ' ? 'Space' : raw.key.trim())
  if (!key || modifierAlias(key)) error(raw.key, 'A shortcut needs a non-modifier key')
  if (key.length > 1 && /[[\]]/.test(key))
    error(raw.key, 'Invalid physical key. Use the code field or a bracketed shortcut token')
  if (/\s/.test(key)) error(raw.key, 'A stroke must contain one key')
  if (key && !knownKeys.has(key) && !isPrintableKey(key)) warn(raw.key, 'Unknown key')
  return Object.freeze({ ...modifiers, key })
}

export function requireShortcut(input: HotkeyInput | string, label = 'Shortcut'): Shortcut {
  const result = parseShortcut(input)
  if (result.ok) return result.value
  const { strokeIndex, token, message } = result.errors[0]!
  throw new Error(`${label}, stroke ${strokeIndex}, token ${JSON.stringify(token)}: ${message}`)
}
