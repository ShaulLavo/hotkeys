import type { AnyCommands, CommandArgs, CommandMap, CommandName } from './commands.js'
import { requireShortcut } from '../shortcut.js'
import type { HotkeyInput } from '../hotkey.types.js'
import { normalizeHotkey } from '../parse.js'
import { buildKeymapTrie, trieStep } from '../chords/trie.js'
import { parseContextPredicate, predicateDepth } from '../context/predicate.js'
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
type BindingKey = {
  readonly keys: HotkeyInput | (string & {})
  readonly context?: string
  readonly source?: BindingSource
}

type BindingEffect = {
  readonly preventDefault?: boolean
  readonly stopPropagation?: boolean
}

export type Binding<Commands extends CommandMap = AnyCommands> = BindingKey &
  BindingEffect &
  (
    | { readonly command: null; readonly args?: never }
    | {
        [Name in CommandName<Commands>]: { readonly command: Name } & CommandArgs<Commands[Name]>
      }[CommandName<Commands>]
  )
export type Unbinding<Commands extends CommandMap = AnyCommands> = BindingKey & {
  readonly unbind: CommandName<Commands>
}
export type KeymapEntry<Commands extends CommandMap = AnyCommands> =
  | Binding<Commands>
  | Unbinding<Commands>

export type CompiledBinding<Commands extends CommandMap = AnyCommands> = {
  readonly entry: KeymapEntry<Commands>
  readonly command: CommandName<Commands> | null
  readonly unbind: CommandName<Commands> | null
  readonly predicate: ContextPredicate | undefined
  readonly rank: number
  readonly index: number
  readonly chord: string
}
export type CompiledKeymap<Commands extends CommandMap = AnyCommands> = {
  readonly platform: KeymapPlatform
  readonly bindings: readonly KeymapBinding<CompiledBinding<Commands>>[]
  readonly root: KeymapNode<CompiledBinding<Commands>>
}

const SOURCE_RANK: Readonly<Record<BindingSource, number>> = {
  default: 0,
  base: 1,
  pack: 2,
  user: 3,
}

/** Parses the table once: chords, predicates and ranks; linear in the number of strokes. */
export function compileKeymap<Commands extends CommandMap = AnyCommands>(
  entries: readonly KeymapEntry<Commands>[],
  platform: KeymapPlatform,
): CompiledKeymap<Commands> {
  const bindings = entries.map((entry, index) => compileEntry<Commands>(entry, index, platform))
  return { platform, bindings, root: buildKeymapTrie(bindings, platform) }
}

function compileEntry<Commands extends CommandMap>(
  entry: KeymapEntry<Commands>,
  index: number,
  platform: KeymapPlatform,
): KeymapBinding<CompiledBinding<Commands>> {
  const chord = requireShortcut(entry.keys, `Keymap entry ${index}`)
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
      chord: chord
        .map((stroke) => normalizeHotkey(stroke, { mode: 'resolved', platform }))
        .join(' '),
    },
  }
}

type Ranked<Commands extends CommandMap> = {
  readonly depth: number
  readonly binding: KeymapBinding<CompiledBinding<Commands>>
}

/**
 * Zed's `bindings_for_input` for one trie node: the commands to try in order, and how many
 * longer chords keep the input pending. Candidates rank by the deepest context their predicate
 * matches, then source, then table order (later first).
 */
export function resolveKeymapNode<Commands extends CommandMap>(
  node: KeymapNode<CompiledBinding<Commands>>,
  stack: readonly KeyContext[],
  isAvailable: (binding: CompiledBinding<Commands>) => boolean = always,
): KeymapSelection<CompiledBinding<Commands>> {
  const bindings = effectiveBindings(node.candidates, stack, isAvailable)
  const first = bindings[0]?.payload.index ?? -1
  return { bindings, pending: pendingChords(node, stack, first, isAvailable) }
}

export function effectiveBindings<Commands extends CommandMap>(
  candidates: readonly KeymapBinding<CompiledBinding<Commands>>[],
  stack: readonly KeyContext[],
  isAvailable: (binding: CompiledBinding<Commands>) => boolean,
  onRemoval?: RemovalReporter<Commands>,
): KeymapBinding<CompiledBinding<Commands>>[] {
  const ranked: Ranked<Commands>[] = []
  for (const binding of candidates) {
    const depth = bindingDepth(binding.payload, stack, isAvailable)
    if (depth !== null) ranked.push({ depth, binding })
  }
  ranked.sort(compareRanked)
  return actionable(ranked, onRemoval)
}

function bindingDepth<Commands extends CommandMap>(
  binding: CompiledBinding<Commands>,
  stack: readonly KeyContext[],
  isAvailable: (binding: CompiledBinding<Commands>) => boolean,
): number | null {
  return isAvailable(binding) ? predicateDepth(binding.predicate, stack) : null
}

function always(): boolean {
  return true
}

function compareRanked<Commands extends CommandMap>(
  a: Ranked<Commands>,
  b: Ranked<Commands>,
): number {
  return (
    b.depth - a.depth ||
    b.binding.payload.rank - a.binding.payload.rank ||
    b.binding.payload.index - a.binding.payload.index
  )
}

type RemovalReporter<Commands extends CommandMap> = (
  entry: CompiledBinding<Commands>,
  blocker: CompiledBinding<Commands>,
) => void

function actionable<Commands extends CommandMap>(
  ranked: readonly Ranked<Commands>[],
  onRemoval?: RemovalReporter<Commands>,
): KeymapBinding<CompiledBinding<Commands>>[] {
  const bindings: KeymapBinding<CompiledBinding<Commands>>[] = []
  const unbound: CompiledBinding<Commands>[] = []
  let clear: CompiledBinding<Commands> | undefined
  for (const { binding } of ranked) {
    const { payload } = binding
    if (payload.command === null && payload.unbind === null) {
      if (!clear || payload.rank > clear.rank) clear = payload
      continue
    }
    if (clear && payload.rank <= clear.rank) {
      onRemoval?.(payload, clear)
      continue
    }
    if (payload.unbind !== null) {
      unbound.push(payload)
      continue
    }
    const blocker = unbound.find((removal) => removes(removal, payload))
    if (blocker) onRemoval?.(payload, blocker)
    if (!blocker) bindings.push(binding)
  }
  return bindings
}

function removes<Commands extends CommandMap>(
  removal: CompiledBinding<Commands>,
  binding: CompiledBinding<Commands>,
): boolean {
  return removal.chord === binding.chord && removal.unbind === binding.command
}

// Resolve each descendant's complete candidate set before applying the exact-prefix cutoff.
// An earlier removal can still suppress a later continuation; each surviving path counts once.
function pendingChords<Commands extends CommandMap>(
  node: KeymapNode<CompiledBinding<Commands>>,
  stack: readonly KeyContext[],
  firstIndex: number,
  isAvailable: (binding: CompiledBinding<Commands>) => boolean,
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

function appendChildNodes<Commands extends CommandMap>(
  remaining: KeymapNode<CompiledBinding<Commands>>[],
  edges: readonly (KeymapEdge<CompiledBinding<Commands>> | undefined)[],
): void {
  for (const edge of edges) {
    if (edge) remaining.push(edge.node)
  }
}

function hasPendingBinding<Commands extends CommandMap>(
  candidates: readonly KeymapBinding<CompiledBinding<Commands>>[],
  stack: readonly KeyContext[],
  firstIndex: number,
  isAvailable: (binding: CompiledBinding<Commands>) => boolean,
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
export function bindingsForInput<Commands extends CommandMap>(
  keymap: CompiledKeymap<Commands>,
  inputs: readonly KeyInput[],
  stack: readonly KeyContext[],
): { readonly bindings: readonly CompiledBinding<Commands>[]; readonly pending: boolean } {
  let node: KeymapNode<CompiledBinding<Commands>> | null = keymap.root
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
