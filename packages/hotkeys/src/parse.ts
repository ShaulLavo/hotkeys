import { assertLogicalKey, splitHotkeyParts } from './_keyboard-event.js'
import { MODIFIER_ALIASES, MODIFIER_ORDER, normalizeKeyName } from './constants.js'
import { detectPlatform } from './platform.js'
import { keyInputFromKeyboardEvent } from './adapters/browser.js'
import { isShortcutSequence, modifierAlias, requireShortcut } from './shortcut.js'
import type { KeyboardEventLike } from './adapters/browser.js'
import type { Platform } from './platform.js'
import type { CanonicalModifier } from './key.types.js'
import type { KeyInput } from './key-input.js'
import type {
  Hotkey,
  HotkeyInput,
  ParsedHotkey,
  RawHotkey,
  RegisterableHotkey,
} from './hotkey.types.js'

export function parseHotkey(
  input: HotkeyStrokeInput,
  platform: Platform = detectPlatform(),
): ParsedHotkey {
  if (typeof input === 'string') return rawHotkeyToParsedHotkey(parseStroke(input), platform)
  if ('ctrlKey' in input) return parseKeyInput(keyInputFromKeyboardEvent(input, platform))
  if ('repeat' in input && 'modifiers' in input) return parseKeyInput(input)
  return rawHotkeyToParsedHotkey(input, platform)
}

type HotkeyStrokeInput = string | RawHotkey | ParsedHotkey | KeyInput | KeyboardEventLike

function parseStroke(input: string): RawHotkey {
  const parts = splitHotkeyParts(input === ' ' ? 'Space' : input)
  const key = normalizeKeyName(parts.pop()?.trim() ?? '')
  const code = /^\[([A-Za-z][A-Za-z0-9]*)\]$/.exec(key)?.[1]
  const modifiers = new Set(parts.map((part) => modifierAlias(part.trim())))
  const raw = {
    mod: modifiers.has('Mod'),
    ctrl: modifiers.has('Control'),
    alt: modifiers.has('Alt'),
    shift: modifiers.has('Shift'),
    meta: modifiers.has('Meta'),
  }
  return code === undefined ? { ...raw, key } : { ...raw, code }
}

export function rawHotkeyToParsedHotkey(
  raw: RawHotkey,
  platform: Platform = detectPlatform(),
): ParsedHotkey {
  if (raw.code === undefined) assertLogicalKey(raw.key)
  const ctrl = Boolean(raw.ctrl || (raw.mod && platform !== 'mac'))
  const alt = raw.alt ?? false
  const shift = raw.shift ?? false
  const meta = Boolean(raw.meta || (raw.mod && platform === 'mac'))
  const flags = { Control: ctrl, Alt: alt, Shift: shift, Meta: meta }
  const modifiers = MODIFIER_ORDER.filter((modifier) => flags[modifier])
  const key = raw.code === undefined ? { key: normalizeKeyName(raw.key) } : { code: raw.code }
  return { ...key, ctrl, shift, alt, meta, modifiers }
}

/**
 * Serializes a parsed hotkey to the canonical string form used for registration
 * and storage: `Mod` first when the platform allows, then `Alt`, then `Shift`;
 * otherwise full `Control+Alt+Shift+Meta` order.
 */
function normalizedHotkeyStringFromParsed(parsed: ParsedHotkey, platform: Platform): Hotkey {
  if (parsed.code === undefined) assertLogicalKey(parsed.key)
  const canUseMod = platform === 'mac' ? parsed.meta && !parsed.ctrl : parsed.ctrl && !parsed.meta

  const parts: Array<string> = []

  if (canUseMod) {
    parts.push('Mod')
    if (parsed.alt) {
      parts.push('Alt')
    }
    if (parsed.shift) {
      parts.push('Shift')
    }
  } else {
    for (const modifier of MODIFIER_ORDER) {
      if (parsed.modifiers.includes(modifier)) {
        parts.push(modifier)
      }
    }
  }

  parts.push(parsed.code !== undefined ? `[${parsed.code}]` : normalizeKeyName(parsed.key))
  return parts.join('+') as Hotkey
}

export type NormalizeMode = 'symbolic' | 'resolved' | 'adaptive'
export type NormalizeHotkeyOptions = { readonly mode?: NormalizeMode; readonly platform?: Platform }

export function normalizeHotkey(
  input: HotkeyInput | HotkeyStrokeInput,
  { mode = 'symbolic', platform = detectPlatform() }: NormalizeHotkeyOptions = {},
): string {
  if (typeof input === 'string' || isShortcutSequence(input)) {
    return requireShortcut(input)
      .map((stroke) => normalizeStroke(stroke, mode, platform))
      .join(' ')
  }
  return normalizeStroke(input, mode, platform)
}

function normalizeStroke(
  input: HotkeyStrokeInput,
  mode: NormalizeMode,
  platform: Platform,
): string {
  const parsed = parseHotkey(input, platform)
  if (mode === 'adaptive') return normalizedHotkeyStringFromParsed(parsed, platform)
  const key = parsed.code === undefined ? parsed.key : `[${parsed.code}]`
  if (mode === 'resolved' || typeof input === 'string' || !('mod' in input) || !input.mod) {
    return Array.from<string>(parsed.modifiers).concat(key).join('+')
  }
  const flags = { Control: input.ctrl, Alt: input.alt, Shift: input.shift, Meta: input.meta }
  return ['Mod']
    .concat(
      MODIFIER_ORDER.filter((modifier) => flags[modifier]),
      key,
    )
    .join('+')
}

/**
 * Same canonical string as {@link normalizeHotkey}, but from an already-parsed hotkey.
 */
export function normalizeHotkeyFromParsed(
  parsed: ParsedHotkey,
  platform: Platform = detectPlatform(),
): Hotkey {
  return normalizedHotkeyStringFromParsed(parsed, platform)
}

/**
 * Normalizes a string or {@link RawHotkey} object to the same canonical hotkey string.
 * Use this in framework adapters instead of branching on `formatHotkey(rawHotkeyToParsedHotkey(...))`.
 */
export function normalizeRegisterableHotkey(
  hotkey: RegisterableHotkey,
  platform: Platform = detectPlatform(),
): Hotkey {
  return typeof hotkey === 'string'
    ? normalizedHotkeyStringFromParsed(parseHotkey(hotkey, platform), platform)
    : normalizeHotkeyFromParsed(rawHotkeyToParsedHotkey(hotkey, platform), platform)
}

/**
 * Checks if a string is a recognized modifier token (including aliases).
 *
 * For a `KeyboardEvent`, use `isModifier(normalizeKeyName(event.key))` so DOM
 * spellings like `OS` / `Win` match the same alias table.
 *
 * @param key - Key name or alias (e.g. from a hotkey string or `event.key`)
 * @returns True if the string is a recognized modifier
 */
export function isModifierKey(key: string): key is keyof typeof MODIFIER_ALIASES {
  return modifierAlias(key) !== undefined
}

/**
 * Parses a key input into a ParsedHotkey, in the same shape `parseHotkey()` returns.
 * AltGraph's synthetic Control+Alt is dropped: the produced glyph is the key.
 */
export function parseKeyInput(input: KeyInput): ParsedHotkey {
  const { altGraph, shift, meta } = input.modifiers
  const ctrl = altGraph ? false : input.modifiers.ctrl
  const alt = altGraph ? false : input.modifiers.alt

  const modifiers: Array<CanonicalModifier> = []
  if (ctrl) modifiers.push('Control')
  if (alt) modifiers.push('Alt')
  if (shift) modifiers.push('Shift')
  if (meta) modifiers.push('Meta')

  return { key: input.key, ctrl, shift, alt, meta, modifiers }
}

/**
 * Normalizes a key input to the same canonical hotkey string as {@link normalizeHotkey}.
 *
 * @param platform - Target platform for `Mod` eligibility
 */
export function normalizeHotkeyFromKeyInput(
  input: KeyInput,
  platform: Platform = detectPlatform(),
): Hotkey {
  return normalizedHotkeyStringFromParsed(parseKeyInput(input), platform)
}

/**
 * Checks if a hotkey or ParsedHotkey contains at least one non-modifier key.
 *
 * This is useful for validating that a recorded hotkey is complete and not
 * just a combination of modifiers without an action key.
 *
 * @param hotkey - The hotkey string or ParsedHotkey to check
 * @param platform - The target platform for parsing (defaults to auto-detection)
 * @returns True if the hotkey contains at least one non-modifier key
 *
 * @example
 * ```ts
 * hasNonModifierKey('Control+Shift+S') // true
 * hasNonModifierKey('Control+Shift') // false (no action key)
 * hasNonModifierKey(parseHotkey('Mod+A')) // true
 * ```
 */
export function hasNonModifierKey(
  hotkey: Hotkey | ParsedHotkey | (string & {}),
  platform: Platform = detectPlatform(),
): boolean {
  const parsed = typeof hotkey === 'string' ? parseHotkey(hotkey, platform) : hotkey

  if (parsed.code !== undefined) {
    // Physical modifier codes identify a side, but still are not action keys.
    return parsed.code.length > 0 && !/^(Control|Shift|Alt|Meta)(Left|Right)$/.test(parsed.code)
  }

  // Check if the key part is actually a modifier
  const keyIsModifier = isModifierKey(parsed.key)

  // A valid hotkey must have a non-modifier key
  return !keyIsModifier && parsed.key.length > 0
}

/**
 * Parses a string or raw binding, resolving Mod for the supplied platform.
 * Physical tokens such as `[KeyQ]` retain `code`; they never become logical Q.
 */
export function parseRegisterableHotkey(
  hotkey: RegisterableHotkey,
  platform = detectPlatform(),
): ParsedHotkey {
  return typeof hotkey === 'string'
    ? parseHotkey(hotkey, platform)
    : rawHotkeyToParsedHotkey(hotkey, platform)
}
