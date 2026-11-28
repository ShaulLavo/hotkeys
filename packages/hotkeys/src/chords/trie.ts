import { LETTER_KEYS, NUMBER_KEYS, PUNCTUATION_CODE_MAP } from '../constants.js'
import { allowsCodeFallback, allowsImplicitShift } from '../_keyboard-event.js'
import { normalizeHotkey, parseHotkey } from '../parse.js'
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
    const parsed = parseHotkey(stroke, platform)
    const modifiers = modifierMask(parsed.alt, parsed.ctrl, parsed.meta, parsed.shift)
    const strokeKey = parsed.code === undefined ? parsed.key : physicalSlot(parsed.code)
    const edges = node.next.get(strokeKey) ?? []
    let edge = edges[modifiers]
    if (!edge)
      edge = { keys: normalizeHotkey(parsed, { mode: 'resolved', platform }), node: emptyNode() }
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
  accepts: (edge: KeymapEdge<Payload>) => boolean = () => true,
): KeymapEdge<Payload> | null {
  const { alt, ctrl, meta, shift, altGraph } = input.modifiers
  // AltGr synthesizes Control+Alt to type a glyph; the glyph is the stroke.
  const modifiers = modifierMask(alt && !altGraph, ctrl && !altGraph, meta, shift)
  const printed = node.next.get(input.key)
  const exact = printed?.[modifiers]
  if (exact && accepts(exact)) return exact
  const physical = input.code ? node.next.get(physicalSlot(input.code))?.[modifiers] : undefined
  if (physical && accepts(physical)) return physical
  const implicit = shift && allowsImplicitShift(input.key) ? printed?.[modifiers & ~8] : undefined
  if (implicit && accepts(implicit)) return implicit
  if (!allowsCodeFallback(input)) return null
  const fallbackKey = PHYSICAL_KEY_NAMES.get(input.code)
  if (!fallbackKey || fallbackKey === input.key) return null
  const fallback = node.next.get(fallbackKey)?.[modifiers]
  return fallback && accepts(fallback) ? fallback : null
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
