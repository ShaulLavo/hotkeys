import { normalizeRegisterableHotkey } from '../parse.js'
import { buildKeymapTrie, trieStep } from '../chords/trie.js'
import { parseContextPredicate, predicateDepth } from '../context/predicate.js'
import type { RegisterableHotkey } from '../hotkey.types.js'
import type { KeyInput } from '../key-input.js'
import type { KeyContext } from '../context/key-context.js'
import type { ContextPredicate } from '../context/predicate.js'
import type { KeyChord, KeymapBinding, KeymapPlatform } from '../chords/types.js'
import type { KeymapSelection } from '../chords/runtime.js'
import type { KeymapEdge, KeymapNode } from '../chords/trie.js'

/**
 * Where a binding comes from, weakest first, as Zed's sources: the default keymap, a base layout
 * (another editor's keys), a pack (vim), the user. A stronger source wins ties.
 */
export type BindingSource = 'default' | 'base' | 'pack' | 'user'
/** A chord as strokes, or one string with strokes separated by spaces (`'Mod+K Mod+C'`). */
export type BindingKeys = KeyChord | string

/**
 * A key→command pair, active where `context` matches the focus path. `command: null`
 * removes equal and weaker sources' bindings for these keys where it matches.
 */
export type Binding = {
  readonly keys: BindingKeys
  readonly command: string | null
  readonly args?: unknown
  readonly context?: string
  readonly source?: BindingSource
  /** False keeps the browser default even when the command runs; true prevents it even when declined. */
  readonly preventDefault?: boolean
  readonly stopPropagation?: boolean
}
/** Removes one key→command pair where `context` matches, leaving other commands on the keys. */
export type Unbinding = {
  readonly keys: BindingKeys
  readonly unbind: string
  readonly context?: string
  readonly source?: BindingSource
}
export type KeymapEntry = Binding | Unbinding

/** A table entry after parsing, carried as the trie payload. */
export type CompiledBinding = {
  readonly entry: KeymapEntry
  readonly command: string | null
  readonly unbind: string | null
  readonly predicate: ContextPredicate | undefined
  readonly rank: number
  readonly index: number
  /** Normalized chord, for comparing entries on the same keys. */
  readonly chord: string
}
export type CompiledKeymap = {
  readonly platform: KeymapPlatform
  readonly bindings: readonly KeymapBinding<CompiledBinding>[]
  readonly root: KeymapNode<CompiledBinding>
}

const SOURCE_RANK: Readonly<Record<BindingSource, number>> = {
  default: 0,
  base: 1,
  pack: 2,
  user: 3,
}

/** Parses the table once: chords, predicates and ranks; linear in the number of strokes. */
export function compileKeymap(
  entries: readonly KeymapEntry[],
  platform: KeymapPlatform,
): CompiledKeymap {
  const bindings = entries.map((entry, index) => compileEntry(entry, index, platform))
  return { platform, bindings, root: buildKeymapTrie(bindings, platform) }
}

function compileEntry(
  entry: KeymapEntry,
  index: number,
  platform: KeymapPlatform,
): KeymapBinding<CompiledBinding> {
  const chord = toChord(entry.keys)
  const isUnbind = 'unbind' in entry
  return {
    chord,
    ...(!isUnbind &&
      entry.preventDefault !== undefined && { preventDefault: entry.preventDefault }),
    ...(!isUnbind &&
      entry.stopPropagation !== undefined && { stopPropagation: entry.stopPropagation }),
    payload: {
      entry,
      command: isUnbind ? null : entry.command,
      unbind: isUnbind ? entry.unbind : null,
      predicate: entry.context === undefined ? undefined : parseContextPredicate(entry.context),
      rank: SOURCE_RANK[entry.source ?? 'user'],
      index,
      chord: chord.map((stroke) => normalizeRegisterableHotkey(stroke, platform)).join(' '),
    },
  }
}

function toChord(keys: BindingKeys): KeyChord {
  if (typeof keys !== 'string') return keys
  const strokes = keys.trim().split(/\s+/) as RegisterableHotkey[]
  return strokes as unknown as KeyChord
}

type Ranked = { readonly depth: number; readonly binding: KeymapBinding<CompiledBinding> }

/**
 * Zed's `bindings_for_input` for one trie node: the commands to try in order, and how many
 * longer chords keep the input pending. Candidates rank by the deepest context their predicate
 * matches, then source, then table order (later first).
 */
export function resolveKeymapNode(
  node: KeymapNode<CompiledBinding>,
  stack: readonly KeyContext[],
  isAvailable: (binding: CompiledBinding) => boolean = always,
): KeymapSelection<CompiledBinding> {
  const bindings = effectiveBindings(node.candidates, stack, isAvailable)
  const first = bindings[0]?.payload.index ?? -1
  return { bindings, pending: pendingChords(node, stack, first, isAvailable) }
}

function effectiveBindings(
  candidates: readonly KeymapBinding<CompiledBinding>[],
  stack: readonly KeyContext[],
  isAvailable: (binding: CompiledBinding) => boolean,
): KeymapBinding<CompiledBinding>[] {
  const ranked: Ranked[] = []
  for (const binding of candidates) {
    const depth = bindingDepth(binding.payload, stack, isAvailable)
    if (depth !== null) ranked.push({ depth, binding })
  }
  ranked.sort(compareRanked)
  return actionable(ranked)
}

function bindingDepth(
  binding: CompiledBinding,
  stack: readonly KeyContext[],
  isAvailable: (binding: CompiledBinding) => boolean,
): number | null {
  return isAvailable(binding) ? predicateDepth(binding.predicate, stack) : null
}

function always(): boolean {
  return true
}

function compareRanked(a: Ranked, b: Ranked): number {
  return (
    b.depth - a.depth ||
    b.binding.payload.rank - a.binding.payload.rank ||
    b.binding.payload.index - a.binding.payload.index
  )
}

function actionable(ranked: readonly Ranked[]): KeymapBinding<CompiledBinding>[] {
  const bindings: KeymapBinding<CompiledBinding>[] = []
  const unbound: CompiledBinding[] = []
  let nullRank = -1
  for (const { binding } of ranked) {
    const { payload } = binding
    if (payload.command === null && payload.unbind === null) {
      nullRank = Math.max(nullRank, payload.rank)
      continue
    }
    if (payload.rank <= nullRank) continue
    if (payload.unbind !== null) {
      unbound.push(payload)
      continue
    }
    if (unbound.some((removal) => removes(removal, payload))) continue
    bindings.push(binding)
  }
  return bindings
}

function removes(removal: CompiledBinding, binding: CompiledBinding): boolean {
  return removal.chord === binding.chord && removal.unbind === binding.command
}

// Resolve each descendant's complete candidate set before applying the exact-prefix cutoff.
// An earlier removal can still suppress a later continuation; each surviving path counts once.
function pendingChords(
  node: KeymapNode<CompiledBinding>,
  stack: readonly KeyContext[],
  firstIndex: number,
  isAvailable: (binding: CompiledBinding) => boolean,
): number {
  if (node.next.size === 0) return 0
  let count = 0
  const remaining = [node]
  while (remaining.length) {
    const current = remaining.pop()!
    for (const edges of current.next.values()) appendChildNodes(remaining, edges)
    if (current === node || current.candidates.length === 0) continue
    if (hasPendingBinding(current.candidates, stack, firstIndex, isAvailable)) count += 1
  }
  return count
}

function appendChildNodes(
  remaining: KeymapNode<CompiledBinding>[],
  edges: readonly (KeymapEdge<CompiledBinding> | undefined)[],
): void {
  for (const edge of edges) {
    if (edge) remaining.push(edge.node)
  }
}

function hasPendingBinding(
  candidates: readonly KeymapBinding<CompiledBinding>[],
  stack: readonly KeyContext[],
  firstIndex: number,
  isAvailable: (binding: CompiledBinding) => boolean,
): boolean {
  // Without removals, ranking cannot change reachability; avoid sorting the whole candidate set.
  if (!candidates.some((binding) => binding.payload.command === null)) {
    return candidates.some(
      ({ payload }) =>
        payload.index >= firstIndex && bindingDepth(payload, stack, isAvailable) !== null,
    )
  }
  return effectiveBindings(candidates, stack, isAvailable).some(
    (binding) => binding.payload.index >= firstIndex,
  )
}

/** What a sequence of keys resolves to under a context stack, for settings and tests. */
export function bindingsForInput(
  keymap: CompiledKeymap,
  inputs: readonly KeyInput[],
  stack: readonly KeyContext[],
): { readonly bindings: readonly CompiledBinding[]; readonly pending: boolean } {
  let node: KeymapNode<CompiledBinding> | null = keymap.root
  for (const input of inputs) {
    node = trieStep(node, input)?.node ?? null
    if (!node) return { bindings: [], pending: false }
  }
  const selection = resolveKeymapNode(node, stack)
  return {
    bindings: selection.bindings.map((binding) => binding.payload),
    pending: selection.pending > 0,
  }
}
