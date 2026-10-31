import { LETTER_KEYS, NUMBER_KEYS, PUNCTUATION_CODE_MAP } from '../constants.js'
import { allowsCodeFallback, allowsImplicitShift } from '../_keyboard-event.js'
import { normalizeRegisterableHotkey, parseHotkey, rawHotkeyToParsedHotkey } from '../parse.js'
import type { KeyInput } from '../key-input.js'
import type { KeymapBinding, KeymapPlatform } from './types.js'

export type KeymapNode<Payload> = {
  readonly next: ReadonlyMap<string, readonly (KeymapEdge<Payload> | undefined)[]>
  /** Bindings whose chord ends at this node, in table order. */
  readonly candidates: readonly KeymapBinding<Payload>[]
  /** Bindings whose chord continues past this node. */
  readonly descendants: readonly KeymapBinding<Payload>[]
}
export type KeymapEdge<Payload> = { readonly keys: string; readonly node: KeymapNode<Payload> }
type MutableNode<Payload> = {
  next: Map<string, ({ keys: string; node: MutableNode<Payload> } | undefined)[]>
  candidates: KeymapBinding<Payload>[]
  descendants: KeymapBinding<Payload>[]
}

/** Builds a stroke trie keyed by printed key and a 4-bit modifier mask; linear in the stroke count. */
export function buildKeymapTrie<Payload>(
  bindings: readonly KeymapBinding<Payload>[],
  platform: KeymapPlatform,
): KeymapNode<Payload> {
  const root = emptyNode<Payload>()
  for (const binding of bindings) insertBinding(root, binding, platform)
  return root
}
function emptyNode<Payload>(): MutableNode<Payload> {
  return { next: new Map(), candidates: [], descendants: [] }
}
function insertBinding<Payload>(
  root: MutableNode<Payload>,
  binding: KeymapBinding<Payload>,
  platform: KeymapPlatform,
) {
  let node = root
  for (const stroke of binding.chord) {
    node.descendants.push(binding)
    const parsed =
      typeof stroke === 'string'
        ? parseHotkey(stroke, platform)
        : rawHotkeyToParsedHotkey(stroke, platform)
    const modifiers = modifierMask(parsed.alt, parsed.ctrl, parsed.meta, parsed.shift)
    const strokeKey = parsed.code === undefined ? parsed.key : physicalSlot(parsed.code)
    const edges = node.next.get(strokeKey) ?? []
    let edge = edges[modifiers]
    if (!edge) edge = { keys: normalizeRegisterableHotkey(stroke, platform), node: emptyNode() }
    edges[modifiers] = edge
    node.next.set(strokeKey, edges)
    node = edge.node
  }
  node.candidates.push(binding)
}

/**
 * Tries exact printed and physical bindings before implicit Shift on a printed glyph, then
 * a compatible positional fallback. Physical and positional matches keep the exact modifiers.
 */
export function trieStep<Payload>(
  node: KeymapNode<Payload>,
  input: Pick<KeyInput, 'key' | 'code' | 'modifiers'>,
): KeymapEdge<Payload> | null {
  const { alt, ctrl, meta, shift, altGraph } = input.modifiers
  // AltGr synthesizes Control+Alt to type a glyph; the glyph is the stroke.
  const modifiers = modifierMask(alt && !altGraph, ctrl && !altGraph, meta, shift)
  const printed = node.next.get(input.key)
  const edge =
    printed?.[modifiers] ??
    (input.code ? node.next.get(physicalSlot(input.code))?.[modifiers] : undefined)
  if (edge) return edge
  const implicit = shift ? printed?.[modifiers & ~8] : undefined
  if (implicit && allowsImplicitShift(input.key)) return implicit
  if (!allowsCodeFallback(input.key, input.code, alt)) return null
  const physical = PHYSICAL_KEY_NAMES.get(input.code)
  if (!physical) return null
  return node.next.get(physical)?.[modifiers] ?? null
}
// Physical bindings (`[KeyQ]`) match the code on every layout, beside the printed-key slots.
function physicalSlot(code: string): string {
  return `[${code}]`
}
function modifierMask(alt: boolean, ctrl: boolean, meta: boolean, shift: boolean): number {
  return (alt ? 1 : 0) | (ctrl ? 2 : 0) | (meta ? 4 : 0) | (shift ? 8 : 0)
}
const PHYSICAL_KEY_NAMES = physicalKeyNames()
function physicalKeyNames(): ReadonlyMap<string, string> {
  const names = new Map(Object.entries(PUNCTUATION_CODE_MAP))
  for (const letter of LETTER_KEYS) names.set(`Key${letter}`, letter)
  for (const digit of NUMBER_KEYS) names.set(`Digit${digit}`, digit)
  return names
}
